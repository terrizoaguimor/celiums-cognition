/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// PluginContext — the runtime container the adapter passes to every
// hook + wiring module. Replaces the implicit closure soup that the
// old monolithic register() function used to maintain.
//
// Why this exists (doctrine A1): the old index.ts had every hook,
// every register* call, and every helper sharing ~12 closure variables
// (ready, getEngine, getModuleStore, autoJournalThrottle, etc.). The
// only way to split the file by domain is to make those closures
// explicit, hand them to each module via a typed context, and let the
// modules consume what they need.
//
// Conventions:
//   - The context is FROZEN once built (no fields added late). Mutable
//     state lives behind functions (`isReady` / `setReady`,
//     `autoJournalShouldFire`) or in refs (`inboxEnqueueRef`).
//   - Hooks/wirings read from ctx and call into the api directly. They
//     never write to ctx.
//   - `buildPluginContext` is invoked once at the top of register().

import { Pool } from "pg";
import {
  createMemoryEngine,
  buildModuleStore,
  type CeliumsMemoryConfig,
  type MemoryEngineWithStore,
  type ModuleStore,
} from "@celiumsai/cognition-engine";
import type { OpenClawPluginApi } from "../api.js";
import type { CognitionConfig } from "../config-schema/index.js";
import type { PoolLike } from "./shared-types.js";
import type { EnqueueNextTurnInjectionFn } from "./autonomy.js";

// ─── edition contract ──────────────────────────────────────────────────
// Mirror of the EditionOptions surface plugin/index.ts exports — kept
// local to break a circular import (the adapter consumes edition opts
// but the legacy index.ts defined them inline).

export interface EditionOptions {
  id: string;
  name: string;
  description: string;
  configSchema: unknown;
  resolveEngineConfig: (cfg: CognitionConfig, api: OpenClawPluginApi) => CeliumsMemoryConfig;
  bootstrap?: (
    engineCfg: CeliumsMemoryConfig,
    api: OpenClawPluginApi,
  ) => Promise<void>;
  migrationsDir?: string;
  seedOptions?: unknown;
  enableUiRoutes?: boolean;
  uiStaticDir?: string;
  pluginVersion?: string;
}

// ─── context shape ─────────────────────────────────────────────────────

export interface PluginContext {
  /** Raw OpenClaw SDK handle. */
  api: OpenClawPluginApi;
  /** Parsed plugin config (defaults applied). */
  cfg: CognitionConfig;
  /** Effective userId (cfg.userId ?? "default"). */
  userId: string;
  /** Edition options the host supplied to createCognitionPlugin. */
  edition: EditionOptions;

  // ── lazy resource accessors ──
  /** Memoized engine init — first call connects storage, subsequent
   *  calls reuse. Throws on failure but resets the memo so the next
   *  call retries. */
  getEngine(): Promise<MemoryEngineWithStore>;
  /** Memoized module store (knowledge corpus). Returns null when the
   *  store cannot be built (config missing, schema mismatch). */
  getModuleStore(): ModuleStore | null;
  /** Reach into the engine's internal pg.Pool. Returns undefined on
   *  pglite / in-memory builds. Attaches a one-time 'error' listener
   *  so a connection-level fault doesn't crash the gateway. */
  extractEnginePool(engine: MemoryEngineWithStore): PoolLike | undefined;

  // ── readiness gate (audit P0 #4) ──
  /** True after service.start completes (migrations + seed applied). */
  isReady(): boolean;
  /** Flip the gate. Called by the service wiring at the end of start
   *  and by stop. */
  setReady(v: boolean): void;
  /** Helper for hook handlers: returns isReady() and emits a one-line
   *  warn on the first gated rejection. */
  gateReady(): boolean;

  // ── auto-journal throttle ──
  /** Sliding-window check used by the agent_end auto-journal hook.
   *  Returns false when the per-agent rate exceeds the cap. */
  autoJournalShouldFire(agentId: string): boolean;

  // ── inbox bridge (Fase F) ──
  /** Captured `api.enqueueNextTurnInjection` reference; null when the
   *  host SDK does not expose the seam. */
  inboxEnqueueRef: { current: EnqueueNextTurnInjectionFn | null };

  // ── tool context builder ──
  /** Build the McpToolContext envelope each tool handler receives. */
  toolCtx(extra?: { agentId?: string; sessionId?: string }): {
    userId: string;
    capabilities: { opencore: true; fleet: boolean; atlas: boolean; ai: boolean };
    agentId: string;
    sessionId?: string;
  };

  // ── cleanup registry ──
  /** Register a teardown callback invoked from service.stop. Used by
   *  intervals (autoJournalThrottle sweep) and other long-lived
   *  state. Idempotent — calling twice with the same fn is safe. */
  registerCleanup(fn: () => void): void;
  /** Invoke every registered cleanup, oldest first. Idempotent. */
  runCleanup(): void;
}

// ─── builder ───────────────────────────────────────────────────────────

const AUTO_JOURNAL_MAX = 30;
const AUTO_JOURNAL_WINDOW_MS = 5 * 60 * 1000;
const AUTO_JOURNAL_SWEEP_MS = 10 * 60 * 1000;

export function buildPluginContext(args: {
  api: OpenClawPluginApi;
  cfg: CognitionConfig;
  edition: EditionOptions;
}): PluginContext {
  const { api, cfg, edition } = args;
  const userId = cfg.userId ?? "default";

  // ─ readiness gate ─
  let ready = false;
  const isReady = () => ready;
  const setReady = (v: boolean) => { ready = v; };
  const gateReady = (): boolean => {
    if (!ready) {
      api.logger.warn?.(
        `celiums-cognition: hook fired before service.start completed — skipping (readiness gate)`,
      );
    }
    return ready;
  };

  // ─ lazy engine + pool ─
  let enginePromise: Promise<MemoryEngineWithStore> | undefined;
  const getEngine = (): Promise<MemoryEngineWithStore> => {
    enginePromise ??= createMemoryEngine(edition.resolveEngineConfig(cfg, api)).catch(
      (err) => {
        enginePromise = undefined;
        throw err;
      },
    );
    return enginePromise;
  };

  const poolErrorBoundPools = new WeakSet<object>();
  const extractEnginePool = (engine: MemoryEngineWithStore): PoolLike | undefined => {
    const store = engine._store as
      | { pg?: { query: (sql: string, params?: unknown[]) => Promise<unknown> } & { on?: (ev: string, cb: (e: Error) => void) => unknown } }
      | undefined;
    const pool = store?.pg as unknown as PoolLike | undefined;
    if (pool && typeof (pool as unknown as { on?: unknown }).on === "function" && !poolErrorBoundPools.has(pool as object)) {
      poolErrorBoundPools.add(pool as object);
      (pool as unknown as { on: (ev: string, cb: (e: Error) => void) => void }).on(
        "error",
        (err: Error) => {
          api.logger.warn?.(
            `celiums-cognition: pg pool error (handled, process kept alive): ${err?.message ?? String(err)}`,
          );
        },
      );
    }
    return pool;
  };

  // ─ module store (knowledge corpus, separate DB) ─
  let moduleStoreCached: ModuleStore | null | undefined;
  const getModuleStore = (): ModuleStore | null => {
    if (moduleStoreCached !== undefined) return moduleStoreCached;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      KNOWLEDGE_DATABASE_URL:
        process.env.KNOWLEDGE_DATABASE_URL ??
        process.env.CELIUMS_DATABASE_URL ??
        (() => {
          api.logger.warn?.(
            `${edition.id}: KNOWLEDGE_DATABASE_URL falling back to legacy default credentials — ` +
            `set CELIUMS_DATABASE_URL or run setup.ts to generate a unique password.`,
          );
          return "postgresql://celiums:celiums@127.0.0.1:5432/celiums_memory";
        })(),
    };
    moduleStoreCached = buildModuleStore(env);
    return moduleStoreCached;
  };

  // ─ tool context envelope ─
  const toolCtx: PluginContext["toolCtx"] = (extra) => ({
    userId,
    capabilities: {
      opencore: true as const,
      fleet: false,
      atlas: !!process.env.CELIUMS_ATLAS_API_KEY,
      ai: !!process.env.CELIUMS_LLM_API_KEY,
    },
    agentId: extra?.agentId ?? cfg.agentId,
    ...(extra?.sessionId ? { sessionId: extra.sessionId } : {}),
  });

  // ─ auto-journal throttle (audit S-017 + P1 #11 sweep) ─
  const autoJournalThrottle = new Map<string, number[]>();
  const autoJournalShouldFire = (agentId: string): boolean => {
    const now = Date.now();
    const cutoff = now - AUTO_JOURNAL_WINDOW_MS;
    const hits = (autoJournalThrottle.get(agentId) ?? []).filter((t) => t > cutoff);
    if (hits.length >= AUTO_JOURNAL_MAX) {
      autoJournalThrottle.set(agentId, hits);
      return false;
    }
    hits.push(now);
    autoJournalThrottle.set(agentId, hits);
    return true;
  };
  const autoJournalSweep = setInterval(() => {
    const now = Date.now();
    const cutoff = now - AUTO_JOURNAL_WINDOW_MS;
    for (const [k, hits] of autoJournalThrottle) {
      const fresh = hits.filter((t) => t > cutoff);
      if (fresh.length === 0) autoJournalThrottle.delete(k);
      else if (fresh.length !== hits.length) autoJournalThrottle.set(k, fresh);
    }
  }, AUTO_JOURNAL_SWEEP_MS);
  autoJournalSweep.unref?.();

  // ─ inbox enqueue ref ─
  const inboxEnqueueRef: PluginContext["inboxEnqueueRef"] = { current: null };

  // ─ cleanup registry ─
  const cleanupFns: Array<() => void> = [];
  const registerCleanup = (fn: () => void) => {
    if (!cleanupFns.includes(fn)) cleanupFns.push(fn);
  };
  registerCleanup(() => clearInterval(autoJournalSweep));
  registerCleanup(() => autoJournalThrottle.clear());
  const runCleanup = () => {
    for (const fn of cleanupFns) {
      try { fn(); } catch (err) {
        api.logger.warn?.(
          `${edition.id}: cleanup callback threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  return Object.freeze({
    api,
    cfg,
    userId,
    edition,
    getEngine,
    getModuleStore,
    extractEnginePool,
    isReady,
    setReady,
    gateReady,
    autoJournalShouldFire,
    inboxEnqueueRef,
    toolCtx,
    registerCleanup,
    runCleanup,
  });
}

// Re-export for convenience so consumers don't need to import from
// multiple spots.
export { Pool };
