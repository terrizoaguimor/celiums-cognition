/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Plugin adapter — wires the vendored Celiums Memory engine to the OpenClaw
// plugin SDK. Follows the VERIFIED external-plugin pattern of
// extensions/memory-lancedb (HANDOFF §10.1): tools + before_prompt_build
// (auto-recall) + agent_end (auto-capture) + before_agent_run/before_tool_call
// (ethics) + service + cli. NO registerTrustedToolPolicy / registerMemory
// Capability (bundled-only / exclusive — see CLAUDE.md §2b). Every engine and
// SDK call here was verified against real source 2026-05-19.

import * as net from "node:net";
import { Pool } from "pg";
import { definePluginEntry, type OpenClawPluginApi } from "../api.js";
import {
  createMemoryEngine,
  buildRegistry,
  buildModuleStore,
  ethics,
  makeMigrationsRunner,
  journalWrite,
  turnContext,
  type CeliumsMemoryConfig,
  type MemoryEngineWithStore,
  type ModuleStore,
  type JournalEntryType,
} from "@celiumsai/cognition-engine";
import { parseConfig, type CognitionConfig } from "../config-schema/index.js";
import { selectTools, CURATED_TOOL_NAMES, type EngineToolLike } from "../tool-curator/index.js";
import {
  applyIfNeeded as applySeedIfNeeded,
  seedOptionsFromEnv,
  skillsRowCount,
  type SeedManagerOptions,
} from "../seed.js";
import { makeUiRouter, type UiRouterContext } from "../ui-routes.js";
import { makeUiStaticHandler } from "../ui-static.js";
import {
  buildMemoryPromptSupplement,
  buildAgentIdentityPreamble,
} from "../prompt-supplement/index.js";
import {
  makeCeliumsCompactionProvider,
  type CompactionProvider,
} from "./compaction.js";
import {
  rememberParentForThread,
  getCachedParent,
  insertLineage,
  closeLineage,
  shouldRefuseSpawn,
  composeBriefing,
  emitJournal,
  lookupParent,
  threadKey,
  DEFAULT_SUBAGENT_CONFIG,
  type SubagentConfig,
  type PoolLike,
} from "./subagent.js";
import {
  withShapeValidation,
  SUBAGENT_SPAWN_BASE_EVENT,
  SUBAGENT_ENDED_EVENT,
  SESSION_START_EVENT,
  SESSION_END_EVENT,
} from "../sdk-contracts.js";
import {
  rememberSessionStart,
  consumeSessionEnd,
  composeSessionEndSummary,
  emitSessionJournal,
  DEFAULT_SESSION_CONFIG,
  type SessionConfig,
} from "./sessions.js";
import {
  buildOperatorActions,
  COGNITION_STATUS_DESCRIPTOR,
  type ActionDeps,
} from "./operator-actions.js";

const CURATED_SET = new Set<string>(CURATED_TOOL_NAMES);

/** Per-edition wiring supplied by packages/hard and packages/lite. */
export interface EditionOptions {
  id: string;
  name: string;
  description: string;
  /** Declarative+runtime config schema (BASE merged with edition keys). */
  configSchema: unknown;
  /** Map plugin config → engine config (Hard: PG/Qdrant/Valkey URLs; Lite: pglite). */
  resolveEngineConfig: (cfg: CognitionConfig, api: OpenClawPluginApi) => CeliumsMemoryConfig;
  /** Optional: bring the local infra up (e.g. Hard's docker stack).
   *  Only invoked when service.start detects required listeners are down
   *  AND the engine config points at localhost endpoints. Idempotent. */
  bootstrap?: (
    engineCfg: CeliumsMemoryConfig,
    api: OpenClawPluginApi,
  ) => Promise<void>;
  /** Optional: directory containing /^\d+.*\.sql$/ migration files.
   *  When set AND engineCfg.databaseUrl is present, service.start runs
   *  the migrations runner after the bootstrap step (idempotent — only
   *  applies pending migrations). Required for Hard (creates ethics_audit,
   *  ethics_knowledge, journal tables, etc.); Lite uses pglite and skips. */
  migrationsDir?: string;
  /** Optional: skills corpus seed configuration. When unset, falls back to
   *  CELIUMS_SEED_URL / CELIUMS_SEED_VERSION env vars; when those are also
   *  unset, no seed is applied (forage returns empty until the operator
   *  configures a seed URL or federates to a hosted knowledge backend). */
  seedOptions?: SeedManagerOptions;
  /** Optional: when true, the adapter registers HTTP routes that back the
   *  Celiums Cognition observability UI (health, counts, pillars, skills
   *  search, skill detail, version check) under
   *  /api/celiums-cognition/*. Hard sets this true; Lite leaves it off
   *  until its own data model is wired (Fase 4). */
  enableUiRoutes?: boolean;
  /** Optional: plugin version string to expose via the UI /health and
   *  /version-check endpoints. Pulled from edition package.json by the
   *  edition entry; defaults to "0.0.0". */
  pluginVersion?: string;
  /** Optional: absolute path to the directory containing the built SPA
   *  (index.html + assets/). When set, the adapter registers a static
   *  file handler at /plugins/celiums-cognition/* so operators can open
   *  the observability dashboard in their browser. */
  uiStaticDir?: string;
}

const AUTO_RECALL_TIMEOUT_MS = 4_000;
const LISTENER_PROBE_TIMEOUT_MS = 1_000;

function isLocalhost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Extract host+port from a connection-string URL (postgresql://, http://, redis://, …). */
function parseHostPort(url: string | undefined): { host: string; port: number } | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const port = u.port ? Number.parseInt(u.port, 10) : NaN;
    if (!u.hostname || !Number.isFinite(port)) return undefined;
    return { host: u.hostname, port };
  } catch {
    return undefined;
  }
}

/** Run pending migrations (idempotent). Uses a short-lived pg.Pool so we
 *  don't piggy-back on the engine's lazy-init pool — migrations need to
 *  apply BEFORE the first tool call asks the engine to query a table. */
async function runMigrations(
  edition: EditionOptions,
  ec: { databaseUrl?: string },
  api: OpenClawPluginApi,
): Promise<void> {
  if (!edition.migrationsDir || !ec.databaseUrl) return;
  const pool = new Pool({ connectionString: ec.databaseUrl, max: 1 });
  try {
    const runner = makeMigrationsRunner({
      pool: pool as unknown as Parameters<typeof makeMigrationsRunner>[0]["pool"],
      migrationsDir: edition.migrationsDir,
      logger: {
        info: (m: string) => api.logger.info(`${edition.id}: migrations: ${m}`),
        warn: (m: string) => api.logger.warn?.(`${edition.id}: migrations: ${m}`),
      },
    });
    const result = await runner.up();
    api.logger.info(
      `${edition.id}: migrations applied=${result.applied.length} skipped=${result.skipped.length}`,
    );
  } catch (err) {
    api.logger.warn?.(
      `${edition.id}: migrations failed — ${err instanceof Error ? err.message : String(err)}; tools may fail until schema is in sync`,
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Apply the skills-corpus seed (idempotent — celiums_migrations tracks
 *  the version). No-op when CELIUMS_SEED_URL is unset or skills already
 *  populated by a prior run. Best-effort: errors are logged, never thrown. */
async function runSeed(
  edition: EditionOptions,
  ec: { databaseUrl?: string },
  api: OpenClawPluginApi,
): Promise<void> {
  if (!ec.databaseUrl) return;
  const seedOpts: SeedManagerOptions | null =
    edition.seedOptions ?? seedOptionsFromEnv();
  if (!seedOpts) return;
  const pool = new Pool({ connectionString: ec.databaseUrl, max: 1 });
  try {
    const applied = await applySeedIfNeeded(
      pool as unknown as Parameters<typeof applySeedIfNeeded>[0],
      {
        ...seedOpts,
        logger: {
          info: (m: string) => api.logger.info(`${edition.id}: ${m}`),
          warn: (m: string) => api.logger.warn?.(`${edition.id}: ${m}`),
        },
      },
    );
    if (applied) {
      const n = await skillsRowCount(
        pool as unknown as Parameters<typeof skillsRowCount>[0],
      );
      if (n != null) {
        api.logger.info(`${edition.id}: skills corpus has ${n} rows`);
      }
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Probe a TCP listener with a short timeout. Resolves true iff `connect` fires. */
function isListenerOpen(host: string, port: number, timeoutMs = LISTENER_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    p,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/** Extract free text from a message's `content` — handles plain strings,
 *  Anthropic-style content blocks ({type:"text",text}), and OpenAI-style
 *  string-only content. Returns "" when no text is present (e.g. content
 *  is exclusively tool calls). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      if ("text" in p && typeof p.text === "string") return p.text;
      return "";
    })
    .join(" ")
    .trim();
}

/** Best-effort extraction of the latest user-authored text from a messages array. */
function latestUserText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (!m || m.role !== "user") continue;
    const text = extractText(m.content).trim();
    if (text) return text;
  }
  return undefined;
}

/** Best-effort extraction of the latest assistant text from a messages array. */
function latestAssistantText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (!m || m.role !== "assistant") continue;
    const text = extractText(m.content).trim();
    if (text) return text;
  }
  return undefined;
}

/** Count tool-use blocks across all messages. Works for both Anthropic
 *  content blocks ({type:"tool_use"|"tool_result"}) and OpenAI's
 *  message-level `tool_calls`/`tool_call_id` shapes. */
function countToolCalls(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;
    // OpenAI style: assistant message carries `tool_calls: []`
    if (Array.isArray(msg.tool_calls)) n += msg.tool_calls.length;
    // Anthropic style: content blocks contain { type: "tool_use" }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use") {
          n += 1;
        }
      }
    }
  }
  return n;
}

export function createCognitionPlugin(edition: EditionOptions) {
  return definePluginEntry({
    id: edition.id,
    name: edition.name,
    description: edition.description,
    kind: "memory",
    configSchema: edition.configSchema as never,
    register(api: OpenClawPluginApi) {
      const cfg: CognitionConfig = parseConfig(api.pluginConfig);
      const userId = cfg.userId ?? "default";
      const trivialSkip = safeRegex(cfg.autoRecall.trivialSkipRegex);

      // Lazy engine init (memoized) — createMemoryEngine connects storage and
      // is async + heavy; defer until first hook/tool actually needs it.
      let enginePromise: Promise<MemoryEngineWithStore> | undefined;
      const getEngine = (): Promise<MemoryEngineWithStore> => {
        enginePromise ??= createMemoryEngine(edition.resolveEngineConfig(cfg, api)).catch(
          (err) => {
            enginePromise = undefined; // allow retry on next call
            throw err;
          },
        );
        return enginePromise;
      };

      // The vendored engine creates its own pg.Pool inside MemoryStore as a
      // private `pg` field. Several MCP tool handlers expect that pool on
      // ctx.pool (journal_*) or ctx.moduleStore (forage). Reach in once
      // through the public `_store` escape hatch and reuse the SAME pool —
      // avoids opening a second connection pool to the same DB.
      // Track which pools we've attached our crash-guard listener to so
      // we don't subscribe twice if the same engine init is observed
      // through different code paths.
      const poolErrorBoundPools = new WeakSet<object>();
      const extractEnginePool = (
        engine: MemoryEngineWithStore,
      ): { query: (sql: string, params?: unknown[]) => Promise<unknown> } | undefined => {
        const store = engine._store as { pg?: { query: (sql: string, params?: unknown[]) => Promise<unknown> } & { on?: (ev: string, cb: (e: Error) => void) => unknown } } | undefined;
        const pool = store?.pg;
        // Audit S-018 (2026-05-21 round 2): pg.Pool emits `error` on
        // connection-level failures (server gone, network blip). Without
        // a listener Node throws an `Unhandled 'error' event` and the
        // gateway crashes — taking down EVERY plugin, not just ours.
        // Attach once per pool. We log + swallow; the next query will
        // either retry or surface the real error to the handler, which
        // already routes through sanitizeDbError.
        if (pool && typeof pool.on === "function" && !poolErrorBoundPools.has(pool as object)) {
          poolErrorBoundPools.add(pool as object);
          pool.on("error", (err: Error) => {
            api.logger.warn?.(
              `celiums-cognition: pg pool error (handled, process kept alive): ${err?.message ?? String(err)}`,
            );
          });
        }
        return pool;
      };

      // moduleStore — knowledge corpus over its OWN database. Default
      // KNOWLEDGE_DATABASE_URL to the engine's CELIUMS_DATABASE_URL so the
      // bundled compose (single Postgres) works out of the box; operators
      // can still override to point at a separate corpus DB.
      let moduleStoreCached: ModuleStore | null | undefined;
      const getModuleStore = (): ModuleStore | null => {
        if (moduleStoreCached !== undefined) return moduleStoreCached;
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          KNOWLEDGE_DATABASE_URL:
            process.env.KNOWLEDGE_DATABASE_URL ??
            process.env.CELIUMS_DATABASE_URL ??
            "postgresql://celiums:celiums@127.0.0.1:5432/celiums_memory",
        };
        moduleStoreCached = buildModuleStore(env);
        return moduleStoreCached;
      };

      const toolCtx = (extra?: { agentId?: string; sessionId?: string }) => ({
        userId,
        capabilities: {
          opencore: true as const,
          fleet: false,
          atlas: !!process.env.CELIUMS_ATLAS_API_KEY,
          ai: !!process.env.CELIUMS_LLM_API_KEY,
        },
        agentId: extra?.agentId ?? cfg.agentId,
        sessionId: extra?.sessionId,
      });

      // ── Tools (curated 8 vs all) ───────────────────────────────────────
      const registry = buildRegistry() as unknown as Array<
        EngineToolLike & {
          handler: (a: Record<string, unknown>, c: unknown) => Promise<{
            content: Array<{ type: "text"; text: string }>;
            isError?: boolean;
          }>;
        }
      >;
      const tools = selectTools(registry, cfg.exposedTools);
      api.logger.info(
        `celiums-cognition: registering ${tools.length}/${registry.length} tools (${cfg.exposedTools})`,
      );

      // ── Compaction provider — Fase A transversal (2026-05-21) ─────────
      // When OpenClaw hits the LLM context limit it asks every
      // registered CompactionProvider for a summary; the operator picks
      // their preferred one. Our provider does three things in a single
      // call: (1) persists worth-saving facts from the about-to-be-
      // dropped messages as memories, (2) writes an `arc` journal entry
      // tagged ["compaction","auto"], (3) returns a structured summary
      // string the next turn can read. The slot is not exclusive — the
      // registry keys by id, so we coexist with memory-core's provider
      // if one exists.
      try {
        const maybeReg = (api as unknown as {
          registerCompactionProvider?: (p: CompactionProvider) => void;
        }).registerCompactionProvider;
        if (typeof maybeReg === "function") {
          const provider = makeCeliumsCompactionProvider({
            getEngine,
            extractPool: extractEnginePool as never,
            userId,
            agentId: cfg.agentId,
            logger: {
              info: (m) => api.logger.info(`celiums-cognition: compaction: ${m}`),
              warn: (m) => api.logger.warn?.(`celiums-cognition: compaction: ${m}`),
            },
          });
          maybeReg.call(api, provider);
          api.logger.info(`celiums-cognition: registered compaction provider (id=${provider.id})`);
        } else {
          api.logger.warn?.(
            `celiums-cognition: api.registerCompactionProvider not available on this host`,
          );
        }
      } catch (err) {
        api.logger.warn?.(
          `celiums-cognition: failed to register compaction provider: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // ── before/after_compaction hooks ─────────────────────────────────
      // The compaction provider is the heavy lifting. These hooks add
      // a thin observation/annotation layer: we know WHEN a compaction
      // started/ended even if the operator picked a different provider,
      // which lets us correlate journal entries with context events.
      api.on(
        "before_compaction",
        async (
          event: { messageCount?: number; tokenCount?: number },
          hookCtx: { agentId?: string; sessionId?: string },
        ) => {
          api.logger.info(
            `celiums-cognition: before_compaction · agent=${hookCtx?.agentId ?? cfg.agentId} · ${event.messageCount ?? "?"} msgs · ${event.tokenCount ?? "?"} tokens`,
          );
        },
      );
      api.on(
        "after_compaction",
        async (
          _event: unknown,
          hookCtx: { agentId?: string; sessionId?: string },
        ) => {
          api.logger.info(
            `celiums-cognition: after_compaction · agent=${hookCtx?.agentId ?? cfg.agentId}`,
          );
        },
      );

      // ── Fase B: subagent lifecycle ─────────────────────────────────────
      // Three hooks: spawning (before child arrives), spawned (child
      // instantiated), ended (child finished). Each handler is wrapped
      // with withShapeValidation so an SDK shape change downgrades to
      // skip+warn instead of crashing the agent turn.
      const subagentCfg: SubagentConfig = DEFAULT_SUBAGENT_CONFIG;

      // (1) subagent_spawning — loop guard + briefing assembly.
      // We return PluginHookSubagentSpawningResult; { status: "ok", … }
      // on success, { status: "error", error } to refuse the spawn.
      api.on(
        "subagent_spawning",
        withShapeValidation(
          SUBAGENT_SPAWN_BASE_EVENT,
          async (
            event: {
              childSessionKey: string;
              agentId: string;
              label?: string;
              mode: "run" | "session";
              requester?: { channel?: string; accountId?: string; to?: string; threadId?: string | number };
              threadRequested: boolean;
            },
            hookCtx: { agentId?: string; sessionId?: string; sessionKey?: string; conversationId?: string },
          ) => {
            try {
              const engine = await getEngine();
              const pool = extractEnginePool(engine);
              if (!pool) return undefined; // pool missing — degrade silently
              const tKey = threadKey(event.requester, hookCtx?.sessionKey);
              const parentEntry = getCachedParent(tKey);
              // Determine parent identity. Falls back to cfg.agentId for
              // root-level spawns where we can't observe a prior parent.
              const parentAgentId = parentEntry?.parentAgentId ?? cfg.agentId;
              // Loop guard: refuse if ancestral depth would exceed max.
              const guard = await shouldRefuseSpawn({ pool: pool as never, parentAgentId, cfg: subagentCfg });
              if (guard.refuse) {
                api.logger.warn?.(
                  `celiums-cognition: subagent_spawning REFUSED · parent=${parentAgentId} · child=${event.agentId} · ${guard.reason}`,
                );
                await emitJournal({
                  pool: pool as never,
                  userId,
                  agentId: parentAgentId,
                  entryType: "doubt",
                  content: `Refused to spawn subagent \`${event.agentId}\` for task "${event.label ?? "(unlabeled)"}" — ${guard.reason}.`,
                  valence: -0.2,
                  valenceReason: "subagent spawn depth guard",
                  tags: ["subagent-refused", "loop-guard"],
                  conversationId: parentEntry?.conversationId,
                });
                return { status: "error" as const, error: guard.reason };
              }
              // Parent's "I'm delegating" journal entry. The child sees
              // a related briefing in its first turn_context (composed
              // live by the before_prompt_build hook below).
              await emitJournal({
                pool: pool as never,
                userId,
                agentId: parentAgentId,
                entryType: "decision",
                content:
                  `Spawning subagent \`${event.agentId}\` (mode=${event.mode}) ` +
                  `for: ${event.label ?? "(unlabeled task)"}.` +
                  (event.requester?.channel ? ` Via channel: ${event.requester.channel}.` : ""),
                valence: 0.1,
                valenceReason: "delegating to subagent",
                tags: ["spawned-subagent", event.agentId],
                conversationId: parentEntry?.conversationId,
              });
              // Insert lineage row early so subagent's before_prompt_build
              // can look up its parent. ended_at stays NULL.
              await insertLineage({
                pool: pool as never,
                parentAgentId,
                childAgentId: event.agentId,
                childSessionKey: event.childSessionKey,
                conversationId: parentEntry?.conversationId,
                taskLabel: event.label,
                mode: event.mode,
                depth: guard.depth,
              });
              api.logger.info(
                `celiums-cognition: subagent_spawning OK · ${parentAgentId} → ${event.agentId} · depth=${guard.depth}`,
              );
              return { status: "ok" as const };
            } catch (err) {
              api.logger.warn?.(
                `celiums-cognition: subagent_spawning handler error: ${err instanceof Error ? err.message : String(err)}`,
              );
              return undefined; // let core continue with default routing
            }
          },
          { warn: (m) => api.logger.warn?.(m) },
        ),
      );

      // (2) subagent_spawned — child is live, no-op besides log; lineage
      // already inserted in spawning. Useful as an observability point.
      api.on(
        "subagent_spawned",
        withShapeValidation(
          SUBAGENT_SPAWN_BASE_EVENT,
          async (
            event: { agentId: string; childSessionKey: string },
            _ctx: unknown,
          ) => {
            api.logger.info(
              `celiums-cognition: subagent_spawned · ${event.agentId} (session=${event.childSessionKey.slice(0, 12)}…)`,
            );
            return undefined;
          },
          { warn: (m) => api.logger.warn?.(m) },
        ),
      );

      // (3) subagent_ended — close lineage row + write retrospective
      // journal entries on BOTH child (arc closing) and parent (lesson
      // or reflection summarizing the child's run).
      api.on(
        "subagent_ended",
        withShapeValidation(
          SUBAGENT_ENDED_EVENT,
          async (
            event: {
              targetSessionKey: string;
              targetKind: "subagent" | "acp";
              reason: string;
              outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
              error?: string;
              endedAt?: number;
            },
            _ctx: unknown,
          ) => {
            if (event.targetKind !== "subagent") return undefined;
            try {
              const engine = await getEngine();
              const pool = extractEnginePool(engine);
              if (!pool) return undefined;
              // Find lineage row by session key to recover identities.
              const { rows: lineRows } = await (pool as PoolLike).query<{
                parent_agent_id: string;
                child_agent_id: string;
                task_label: string | null;
                conversation_id: string | null;
              }>(
                `SELECT parent_agent_id, child_agent_id, task_label, conversation_id::text
                   FROM agent_lineage
                  WHERE child_session_key = $1
                  LIMIT 1`,
                [event.targetSessionKey],
              );
              if (lineRows.length === 0) {
                api.logger.warn?.(
                  `celiums-cognition: subagent_ended without prior lineage row · session=${event.targetSessionKey.slice(0, 12)}…`,
                );
                return undefined;
              }
              const lin = lineRows[0];
              const outcomeOk = event.outcome === "ok" || event.outcome === undefined;
              // Child's closing arc — formal end of its chain.
              await emitJournal({
                pool: pool as never,
                userId,
                agentId: lin.child_agent_id,
                entryType: "arc",
                content:
                  `Session closing. Outcome: ${event.outcome ?? "unspecified"}.` +
                  (event.reason ? ` Reason: ${event.reason}.` : "") +
                  (event.error ? ` Error: ${event.error.slice(0, 400)}.` : ""),
                valence: outcomeOk ? 0.1 : -0.3,
                valenceReason: `subagent ended with outcome=${event.outcome ?? "unspecified"}`,
                tags: ["session-end", "subagent"],
                conversationId: lin.conversation_id ?? undefined,
              });
              // Parent's retrospective — lesson on failure paths,
              // reflection on success. Closes the causal loop with the
              // spawn decision via shared conversation_id + tags.
              await emitJournal({
                pool: pool as never,
                userId,
                agentId: lin.parent_agent_id,
                entryType: outcomeOk ? "reflection" : "lesson",
                content:
                  `Subagent \`${lin.child_agent_id}\` ended` +
                  ` (outcome=${event.outcome ?? "?"})` +
                  (lin.task_label ? ` after working on: ${lin.task_label}.` : ".") +
                  (event.error ? ` Error surfaced: ${event.error.slice(0, 200)}.` : "") +
                  ` See chain agent_id=${lin.child_agent_id}.`,
                valence: outcomeOk ? 0.2 : -0.3,
                valenceReason: `subagent retrospective on parent chain`,
                tags: [`from-subagent:${lin.child_agent_id}`],
                conversationId: lin.conversation_id ?? undefined,
              });
              // Close lineage row.
              await closeLineage({
                pool: pool as never,
                childAgentId: lin.child_agent_id,
                childSessionKey: event.targetSessionKey,
                outcome: event.outcome,
                summary: event.reason,
                error: event.error,
              });
              api.logger.info(
                `celiums-cognition: subagent_ended · ${lin.parent_agent_id} ← ${lin.child_agent_id} · outcome=${event.outcome ?? "?"}`,
              );
              return undefined;
            } catch (err) {
              api.logger.warn?.(
                `celiums-cognition: subagent_ended handler error: ${err instanceof Error ? err.message : String(err)}`,
              );
              return undefined;
            }
          },
          { warn: (m) => api.logger.warn?.(m) },
        ),
      );

      // ── Fase C: session lifecycle ──────────────────────────────────────
      // Two hooks: session_start (open a conversation thread, optionally
      // resumed) and session_end (close it with a deterministic summary).
      // Boundaries make weeks-back paging through the journal navigable
      // — without them the feed is one continuous stream with no anchors.
      //
      // Doctrine citations:
      //   - P1: composable section helpers (sessions.ts owns its own surface)
      //   - M4: end summary cites scan caps + how to retrieve the rest
      //   - G1: hooks return typed results; failures degrade to log
      //   - L2: openSessions tracker has a single cleanup path (_resetSessionTracker)
      //
      // The journal entries land scoped to `conversation_id = sessionId`
      // so /journal/recent?conversation_id=… already groups them; no UI
      // change is required to make sessions navigable.
      const sessionCfg: SessionConfig = DEFAULT_SESSION_CONFIG;

      // (1) session_start — anchor entry + remember in-memory.
      // We emit a lightweight `reflection` so the operator paging back
      // sees an explicit "session opened" line. The remember() call is
      // what lets session_end compute a real duration when the SDK
      // doesn't supply durationMs.
      api.on(
        "session_start",
        withShapeValidation(
          SESSION_START_EVENT,
          async (
            event: { sessionId: string; sessionKey?: string; resumedFrom?: string },
            hookCtx: { agentId?: string; sessionId?: string; sessionKey?: string },
          ) => {
            try {
              const engine = await getEngine();
              const pool = extractEnginePool(engine);
              if (!pool) return undefined;
              const effectiveAgent = hookCtx?.agentId ?? cfg.agentId;
              rememberSessionStart(
                event.sessionId,
                effectiveAgent,
                event.resumedFrom,
                event.sessionId,
                sessionCfg,
              );
              const content = event.resumedFrom
                ? `Session opened; continuation of \`${event.resumedFrom.slice(0, 12)}…\`.`
                : `Session opened.`;
              const tags = event.resumedFrom
                ? ["session-start", `resumed-from:${event.resumedFrom.slice(0, 12)}`]
                : ["session-start"];
              await emitSessionJournal({
                pool: pool as never,
                userId,
                agentId: effectiveAgent,
                entryType: "reflection",
                content,
                valence: 0.05,
                valenceReason: "fresh session — no signal yet",
                tags,
                conversationId: event.sessionId,
              });
              api.logger.info(
                `celiums-cognition: session_start · ${event.sessionId.slice(0, 12)}… · agent=${effectiveAgent}` +
                (event.resumedFrom ? ` · resumed-from=${event.resumedFrom.slice(0, 12)}…` : ""),
              );
              return undefined;
            } catch (err) {
              api.logger.warn?.(
                `celiums-cognition: session_start handler error: ${err instanceof Error ? err.message : String(err)}`,
              );
              return undefined;
            }
          },
          { warn: (m) => api.logger.warn?.(m) },
        ),
      );

      // (2) session_end — arc entry with deterministic summary.
      // Pulls counts from agent_journal + agent_lineage where
      // conversation_id matches; M4 truncation is automatic.
      api.on(
        "session_end",
        withShapeValidation(
          SESSION_END_EVENT,
          async (
            event: {
              sessionId: string;
              sessionKey?: string;
              messageCount: number;
              durationMs?: number;
              reason?: string;
              sessionFile?: string;
              transcriptArchived?: boolean;
              nextSessionId?: string;
              nextSessionKey?: string;
            },
            hookCtx: { agentId?: string; sessionId?: string; sessionKey?: string },
          ) => {
            try {
              const engine = await getEngine();
              const pool = extractEnginePool(engine);
              if (!pool) return undefined;
              const tracked = consumeSessionEnd(event.sessionId);
              const effectiveAgent = tracked?.agentId ?? hookCtx?.agentId ?? cfg.agentId;
              const reasonStr = event.reason ?? "unknown";
              const summary = await composeSessionEndSummary({
                pool: pool as never,
                sessionId: event.sessionId,
                agentId: effectiveAgent,
                reason: reasonStr,
                durationMs: event.durationMs,
                messageCount: event.messageCount,
                startedAt: tracked?.startedAt,
                resumedFrom: tracked?.resumedFrom,
                nextSessionId: event.nextSessionId,
                cfg: sessionCfg,
              });
              await emitSessionJournal({
                pool: pool as never,
                userId,
                agentId: effectiveAgent,
                entryType: "arc",
                content: summary.text,
                valence: 0,
                valenceReason: "session boundary — neutral closing arc",
                tags: ["session-end", `reason:${reasonStr}`],
                conversationId: event.sessionId,
              });
              api.logger.info(
                `celiums-cognition: session_end · ${event.sessionId.slice(0, 12)}… · ` +
                `reason=${reasonStr} · scanned=${summary.scanned}${summary.truncated ? " (capped)" : ""}`,
              );
              return undefined;
            } catch (err) {
              api.logger.warn?.(
                `celiums-cognition: session_end handler error: ${err instanceof Error ? err.message : String(err)}`,
              );
              return undefined;
            }
          },
          { warn: (m) => api.logger.warn?.(m) },
        ),
      );

      // ── Fase D: operator actions + control UI ──────────────────────────
      // Operator-side slash commands and a status widget. The agent does
      // not invoke these — the operator does, via the OpenClaw shell
      // (slash-command surface or button). Feature-detected so the
      // plugin runs on older gateways without these seams.
      //
      // Doctrine citations:
      //   - T3: actions declared as data; handlers lazy via factory
      //   - U4: forget is a typed permission request (mandatory reason)
      //   - U5: status surfaces exactly four critical metrics
      //   - U6: forget arms first, executes on confirm within 10s
      //   - G2: recall result never fabricates — 0 hits cites recovery path
      const actionDeps: ActionDeps = {
        getEngine,
        extractPool: extractEnginePool as never,
        userId,
        agentId: cfg.agentId,
        ethicsMode: (cfg as { ethics?: { mode?: string } }).ethics?.mode ?? "radar",
        logger: {
          info: (m: string) => api.logger.info(m),
          warn: (m: string) => api.logger.warn?.(m),
        },
      };
      const operatorActions = buildOperatorActions(actionDeps);

      const registerSessionAction = (
        api as unknown as {
          registerSessionAction?: (action: unknown) => void;
        }
      ).registerSessionAction;
      if (typeof registerSessionAction === "function") {
        for (const action of operatorActions) {
          try {
            registerSessionAction.call(api, action);
            api.logger.info(
              `celiums-cognition: registered session action ${action.id}`,
            );
          } catch (err) {
            api.logger.warn?.(
              `celiums-cognition: failed to register action ${action.id}: ` +
              (err instanceof Error ? err.message : String(err)),
            );
          }
        }
      } else {
        api.logger.warn?.(
          `celiums-cognition: api.registerSessionAction not available — operator slash commands skipped on this gateway`,
        );
      }

      const registerControlUiDescriptor = (
        api as unknown as {
          registerControlUiDescriptor?: (descriptor: unknown) => void;
        }
      ).registerControlUiDescriptor;
      if (typeof registerControlUiDescriptor === "function") {
        try {
          registerControlUiDescriptor.call(api, COGNITION_STATUS_DESCRIPTOR);
          api.logger.info(
            `celiums-cognition: registered control UI descriptor (${COGNITION_STATUS_DESCRIPTOR.id})`,
          );
        } catch (err) {
          api.logger.warn?.(
            `celiums-cognition: failed to register control UI descriptor: ` +
            (err instanceof Error ? err.message : String(err)),
          );
        }
      } else {
        api.logger.warn?.(
          `celiums-cognition: api.registerControlUiDescriptor not available — cognition widget skipped on this gateway`,
        );
      }

      // ── Memory prompt supplement (cache-stable system-prompt section) ──
      // Teaches the model HOW to operate the cognitive surface this
      // plugin exposes — when to call each tool, how to read the affect
      // signals returned, integrity rules, ethics layer behavior, and
      // anti-injection handling. Filtered by availableTools so the model
      // only sees guidance for what it can actually invoke. The builder
      // runs at every prompt-build but produces a stable string per
      // (toolset, citationsMode) pair, so prompt-cache reuse is preserved.
      try {
        const maybeRegister = (api as unknown as {
          registerMemoryPromptSupplement?: (
            builder: (params: { availableTools?: unknown; citationsMode?: unknown }) => string[],
          ) => void;
        }).registerMemoryPromptSupplement;
        if (typeof maybeRegister === "function") {
          maybeRegister.call(api, (params: { availableTools?: unknown; citationsMode?: unknown }) => {
            const tools = params?.availableTools as Set<string> | string[] | undefined;
            return buildMemoryPromptSupplement(tools);
          });
          api.logger.info(`celiums-cognition: registered memory prompt supplement`);
        } else {
          api.logger.warn?.(
            `celiums-cognition: api.registerMemoryPromptSupplement not available on this host — model will not see the operating guide`,
          );
        }
      } catch (err) {
        api.logger.warn?.(
          `celiums-cognition: failed to register prompt supplement: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      for (const tool of tools) {
        api.registerTool(
          {
            name: tool.definition.name,
            label: tool.definition.name,
            description: tool.definition.description ?? tool.definition.name,
            parameters: (tool.definition.inputSchema ?? {
              type: "object",
              properties: {},
            }) as never,
            async execute(_toolCallId: string, params: unknown) {
              try {
                const engine = await getEngine();
                const pool = extractEnginePool(engine);
                const moduleStore = getModuleStore();
                const res = (await tool.handler(
                  (params ?? {}) as Record<string, unknown>,
                  {
                    ...toolCtx(),
                    memoryEngine: engine,
                    ...(pool ? { pool } : {}),
                    ...(moduleStore ? { moduleStore } : {}),
                  },
                )) as { content: Array<{ type: "text"; text: string }>; isError?: boolean };
                return { content: res.content, ...(res.isError ? { isError: true } : {}) };
              } catch (err) {
                return {
                  content: [{ type: "text", text: `celiums-cognition error: ${String(err)}` }],
                  isError: true,
                };
              }
            },
          } as never,
          // Curated tools are required; the rest (only registered when
          // exposedTools="all") are opt-in, matching toolMetadata.optional
          // in the manifest (official guide: building-plugins.md).
          CURATED_SET.has(tool.definition.name)
            ? { name: tool.definition.name }
            : { name: tool.definition.name, optional: true },
        );
      }

      // ── Proactive turn-context (before_prompt_build → prependContext) ──
      //
      // Mario's call (2026-05-21): "el plugin se vuelve el ADN del software".
      // The agent shouldn't have to *decide* to call turn_context — the
      // 8 channels (identity priors + continuity briefing + auto-recalled
      // memory + forage corpus + ethics-advisory + epistemic-flag +
      // suggestion-intents + limbic PAD state) must be present on every
      // turn by default.
      //
      // We invoke the engine's `turnContext()` directly (library facade,
      // not via the MCP tool registry) and inject its composed context
      // into the system prompt. The composer is token-budgeted ~3000
      // chars and dedup-guarded internally, so safe to call every turn.
      //
      // Falls back to the older lightweight auto-recall path on any
      // failure: a turn must NEVER be blocked by this hook.
      if (cfg.autoRecall.enabled) {
        api.on("before_prompt_build", async (
          event: { prompt?: string; messages?: unknown; agentId?: string },
          hookCtx: { sessionKey?: string; sessionId?: string; agentId?: string; conversationId?: string },
        ) => {
          const q = (latestUserText(event.messages) ?? event.prompt ?? "").trim();
          if (q.length < 5 || (trivialSkip && trivialSkip.test(q))) return undefined;
          try {
            const engine = await getEngine();
            const pool = extractEnginePool(engine);
            if (!pool) {
              // No PG pool — fall back to the lightweight recall-only path.
              const recalled = await withTimeout(
                engine.recall({ query: q, userId, limit: 5 }),
                AUTO_RECALL_TIMEOUT_MS,
              );
              if (!recalled?.memories?.length || !recalled.assembledContext) return undefined;
              return { prependContext: recalled.assembledContext };
            }
            const ctx = {
              userId,
              capabilities: {
                opencore: true as const,
                fleet: !!process.env.CELIUMS_FLEET_API_KEY,
                atlas: !!process.env.CELIUMS_ATLAS_API_KEY,
                ai: !!process.env.CELIUMS_LLM_API_KEY,
              },
              agentId: hookCtx?.agentId ?? event.agentId ?? cfg.agentId,
              sessionId: hookCtx?.sessionId ?? hookCtx?.sessionKey,
              conversationId: hookCtx?.conversationId,
              memoryEngine: engine,
              pool,
            };
            // NB: the engine's handler reads args.userMessage (camelCase)
            // even though lib/proactive.ts types it as `user_message`.
            // Pass both keys to survive either resolution path.
            const tc = await withTimeout(
              turnContext(
                { user_message: q, userMessage: q, max_chars: 3000 } as never,
                ctx as never,
              ),
              AUTO_RECALL_TIMEOUT_MS,
            );
            // Identity preamble — small dynamic block telling THIS
            // specific agent which `agent_id` owns the journal entries
            // it's about to write. Prepended to the static-supplement +
            // dynamic-turn_context stack so the model can't mistake
            // someone else's voice for its own. Cache-unstable but tiny.
            const identityPreamble = buildAgentIdentityPreamble({
              agentId: ctx.agentId,
              sessionId: ctx.sessionId,
              conversationId: ctx.conversationId,
            });
            // Fase B: live re-briefing for subagents. If THIS agent is
            // registered in agent_lineage as a child whose parent
            // session is still open, inject the parent's recent journal
            // entries every turn — not just at spawn. That way the
            // child sees parent decisions taken AFTER it was spawned.
            // Cheap: one indexed lookup + one query. Best-effort.
            let parentBriefing = "";
            try {
              const meAsChildAgent = ctx.agentId ?? event.agentId ?? cfg.agentId;
              const parentInfo = await lookupParent(pool as never, meAsChildAgent);
              if (parentInfo) {
                const engine2 = await getEngine();
                parentBriefing = await composeBriefing({
                  pool: pool as never,
                  engine: engine2,
                  parentAgentId: parentInfo.parentAgentId,
                  childAgentId: meAsChildAgent,
                  taskLabel: parentInfo.taskLabel ?? undefined,
                  cfg: subagentCfg,
                });
              }
            } catch { /* re-briefing is best-effort */ }

            if (!tc?.context || tc.total_chars === 0) {
              return {
                prependContext: parentBriefing
                  ? `${identityPreamble}\n\n${parentBriefing}`
                  : identityPreamble,
              };
            }
            api.logger.info?.(
              `celiums-cognition: turn_context ${tc.total_chars} chars · channels: ${(tc.channels_loaded ?? []).join(",")} · agent=${ctx.agentId}${parentBriefing ? " · with-parent-briefing" : ""}`,
            );
            return {
              prependContext: [identityPreamble, parentBriefing, tc.context]
                .filter((s) => s && s.length > 0)
                .join("\n\n"),
            };
          } catch (err) {
            // Best-effort: try the lightweight recall path before giving up.
            api.logger.warn(`celiums-cognition: turn_context failed (${String(err)}); falling back to recall-only`);
            try {
              const engine = await getEngine();
              const recalled = await withTimeout(
                engine.recall({ query: q, userId, limit: 5 }),
                AUTO_RECALL_TIMEOUT_MS,
              );
              if (!recalled?.memories?.length || !recalled.assembledContext) return undefined;
              return { prependContext: recalled.assembledContext };
            } catch (err2) {
              api.logger.warn(`celiums-cognition: recall fallback also failed: ${String(err2)}`);
              return undefined;
            }
          }
        });
      }

      // ── Auto-capture (agent_end → engine.store) ────────────────────────
      if (cfg.autoCapture.enabled) {
        api.on(
          "agent_end",
          async (
            event: { success?: boolean; messages?: unknown; agentId?: string },
            ctx: { sessionKey?: string; sessionId?: string; agentId?: string; conversationId?: string; requester?: { channel?: string; accountId?: string; to?: string; threadId?: string | number } },
          ) => {
            // Remember this agent as the parent-of-record for its
            // current thread, so the next subagent_spawning fired from
            // the same thread can identify us as the parent. The SDK
            // doesn't pass parent_session_key in spawn events, so this
            // map is how we recover the parent identity. 1h TTL.
            const tKey = threadKey(ctx?.requester, ctx?.sessionKey);
            if (tKey) {
              rememberParentForThread(
                tKey,
                ctx?.agentId ?? event.agentId ?? cfg.agentId,
                ctx?.sessionId,
                ctx?.conversationId,
              );
            }
            if (!event.success) return;
            const text = latestUserText(event.messages);
            if (!text) return;
            try {
              const engine = await getEngine();
              await engine.store([{ content: text, userId } as never]);
            } catch (err) {
              api.logger.warn(`celiums-cognition: auto-capture failed: ${String(err)}`);
            }
          },
        );
      }

      // Per-agent throttle for auto-journal writes — audit S-017
      // (2026-05-21 round 2). The gateway might spawn a flurry of
      // subagents for one user task; each one's agent_end fires our
      // hook and inserts a row. Without a cap, a runaway loop or a
      // malicious agent can flood agent_journal. Bounded sliding
      // window per agent_id: max 30 entries per 5 minutes. Excess
      // entries are dropped silently — the operator's own
      // journal_write calls are unaffected, only the auto baseline
      // is suppressed.
      const autoJournalThrottle = new Map<string, number[]>();
      const AUTO_JOURNAL_MAX = 30;
      const AUTO_JOURNAL_WINDOW_MS = 5 * 60 * 1000;
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

      // ── Auto-journal (agent_end → agent_journal) ───────────────────────
      // Mario's call (2026-05-20): the journal can't be left as a manual
      // tool — the agent has to be RAILED into writing entries so it can
      // come back to its own steps. Every meaningful turn closes with a
      // journal_write here. "Meaningful" = the user message clears
      // minTurnLength and the agent actually responded.
      //
      // Heuristic for entry_type (cheap — no LLM call):
      //   - tool calls happened → "decision" (the agent committed to an action)
      //   - assistant length >> user length → "reflection" (the agent ELABORATED)
      //   - event.success === false (rare on agent_end) → "doubt"
      //   - default → "reflection"
      // The agent can always supersede or refine via journal_supersede later.
      if (cfg.journal.enabled && cfg.journal.autoWrite.enabled) {
        api.on(
          "agent_end",
          async (
            event: {
              success?: boolean;
              messages?: unknown;
              prompt?: string;
              agentId?: string;
            },
            ctx: { sessionKey?: string; sessionId?: string; agentId?: string },
          ) => {
            const userText = latestUserText(event.messages) ?? event.prompt ?? "";
            const assistantText = latestAssistantText(event.messages) ?? "";
            const toolCalls = countToolCalls(event.messages);
            // Skip pings ("ok", "gracias", short ack) — minTurnLength gates this.
            if (userText.trim().length < cfg.journal.autoWrite.minTurnLength) return;
            // Skip if the agent didn't produce anything substantial either.
            if (assistantText.trim().length < 20) return;
            // Per-agent flood guard (S-017): cap auto-journal writes at
            // 30 per 5 minutes per agent_id. Operator's deliberate
            // `journal_write` calls are unaffected.
            const journalAgentId = ctx?.agentId ?? event.agentId ?? cfg.agentId;
            if (!autoJournalShouldFire(journalAgentId)) {
              api.logger.warn?.(
                `celiums-cognition: auto-journal throttled for agent=${journalAgentId}`,
              );
              return;
            }

            // entry_type heuristic
            let entryType: JournalEntryType = "reflection";
            if (event.success === false) {
              entryType = "doubt";
            } else if (toolCalls >= 2) {
              entryType = "decision";
            } else if (assistantText.length > userText.length * 4) {
              entryType = "reflection";
            }

            // valence heuristic: success → mildly positive, failure → mildly
            // negative. The agent's own future journal_write calls will
            // override with finer-grained values when it explicitly reflects.
            const valence = event.success === false ? -0.3 : 0.2;

            // Content snapshot — cheap structured prose the operator can
            // grep. Trimmed so a long turn doesn't bloat the journal.
            const content = [
              `User: ${userText.slice(0, 600)}${userText.length > 600 ? "…" : ""}`,
              `Agent (${toolCalls} tool call${toolCalls === 1 ? "" : "s"}): ${assistantText.slice(0, 800)}${assistantText.length > 800 ? "…" : ""}`,
            ].join("\n\n");

            try {
              const engine = await getEngine();
              const pool = extractEnginePool(engine);
              if (!pool) return;
              await journalWrite(
                {
                  entry_type: entryType,
                  content,
                  valence,
                  valence_reason: event.success === false ? "agent turn ended with success=false" : "agent turn closed",
                  tags: ["auto", "agent_end", ...(toolCalls > 0 ? ["with-tools"] : [])],
                  visibility: "self",
                  conversation_id: ctx.sessionId ?? ctx.sessionKey,
                  agent_id: ctx.agentId ?? event.agentId ?? cfg.agentId,
                },
                {
                  userId,
                  capabilities: {
                    opencore: true as const,
                    fleet: false,
                    atlas: false,
                    ai: false,
                  },
                  agentId: ctx.agentId ?? event.agentId ?? cfg.agentId,
                  sessionId: ctx.sessionId ?? ctx.sessionKey,
                  pool,
                } as never,
              );
            } catch (err) {
              // Best-effort — the auto-journal must never break the turn.
              api.logger.warn?.(
                `celiums-cognition: auto-journal failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          },
        );
      }

      // ── Ethics gate (public hooks — NOT registerTrustedToolPolicy) ─────
      if (cfg.ethics.enabled) {
        const judge = (text: string): { block: boolean; reason: string } => {
          const r = ethics.evaluate(text);
          if (r.passed) return { block: false, reason: "" };
          const hard = r.violations?.some((v: { blocked?: boolean }) => v.blocked) ?? false;
          // strictMode blocks any non-pass; otherwise only hard (blocked) violations.
          const block = cfg.ethics.strictMode ? true : hard;
          return {
            block,
            reason: `Celiums ethics: ${r.violations?.map((v: { category?: string }) => v.category).join(", ") || "policy violation"}`,
          };
        };
        api.on(
          "before_agent_run",
          (event: { prompt?: string }) => {
            if (!event.prompt) return undefined;
            const v = judge(event.prompt);
            return v.block ? { outcome: "block" as const, reason: v.reason } : undefined;
          },
        );
        api.on(
          "before_tool_call",
          (event: { toolName?: string; args?: unknown }) => {
            const probe = `${event.toolName ?? ""} ${JSON.stringify(event.args ?? {})}`;
            const v = judge(probe);
            return v.block ? { block: true as const, reason: v.reason } : undefined;
          },
        );
      }

      // ── Service + CLI ──────────────────────────────────────────────────
      // service.start fallback: if the edition declared bootstrap and the
      // required listeners aren't up, run bootstrap idempotently. Only
      // probes localhost endpoints — if the operator has pointed the
      // engine at a remote DB (e.g. DO Managed PG) we assume they manage
      // their own infra and stay out of the way. Bootstrap failures are
      // logged but never crash plugin start; the engine init is still
      // lazy and will surface a clearer error at first tool call.
      api.registerService({
        id: edition.id,
        start: async () => {
          if (!edition.bootstrap) {
            api.logger.info(`${edition.id}: ready (engine init is lazy)`);
            return;
          }
          const engineCfg = edition.resolveEngineConfig(cfg, api);
          const ec = engineCfg as {
            databaseUrl?: string;
            qdrantUrl?: string;
            valkeyUrl?: string;
          };
          const candidates = [
            { name: "postgres", endpoint: parseHostPort(ec.databaseUrl) },
            { name: "qdrant", endpoint: parseHostPort(ec.qdrantUrl) },
            { name: "valkey", endpoint: parseHostPort(ec.valkeyUrl) },
          ].flatMap((c) =>
            c.endpoint && isLocalhost(c.endpoint.host)
              ? [{ name: c.name, host: c.endpoint.host, port: c.endpoint.port }]
              : [],
          );
          if (candidates.length === 0) {
            api.logger.info(
              `${edition.id}: ready (engine init is lazy, no local stack to bootstrap)`,
            );
            return;
          }
          const checks = await Promise.all(
            candidates.map(async (c) => ({ ...c, up: await isListenerOpen(c.host, c.port) })),
          );
          const down = checks.filter((c) => !c.up);
          if (down.length === 0) {
            api.logger.info(
              `${edition.id}: ready (stack up — ${checks.map((c) => `${c.name}:${c.port}`).join(", ")})`,
            );
            await runMigrations(edition, ec, api);
            await runSeed(edition, ec, api);
            return;
          }
          api.logger.info(
            `${edition.id}: bootstrap — ${down.map((d) => `${d.name}:${d.port}`).join(", ")} not responding; running setup…`,
          );
          try {
            await edition.bootstrap(engineCfg, api);
            api.logger.info(`${edition.id}: ready (bootstrap completed)`);
            await runMigrations(edition, ec, api);
            await runSeed(edition, ec, api);
          } catch (err) {
            api.logger.warn?.(
              `${edition.id}: bootstrap failed — ${err instanceof Error ? err.message : String(err)}; engine will surface a clearer error at first tool call`,
            );
          }
        },
        stop: () => {
          api.logger.info(`${edition.id}: stopped`);
        },
      });

      // ── HTTP routes (observability UI backend) ────────────────────────
      // When the edition opts in (Hard: yes, Lite: not yet), register a
      // prefix route under /api/celiums-cognition/* that the SPA frontend
      // consumes. The handler resolves its dependencies (pg pool, engine
      // config, TEI url, plugin metadata) lazily on first request — we
      // can't access them at register() time because the engine is
      // lazy-init.
      if (edition.enableUiRoutes) {
        let uiRouterCache: ReturnType<typeof makeUiRouter> | undefined;
        const ensureRouter = async (): Promise<ReturnType<typeof makeUiRouter>> => {
          if (uiRouterCache) return uiRouterCache;
          const engine = await getEngine();
          const pool = extractEnginePool(engine);
          if (!pool) {
            throw new Error(
              "UI routes require a Postgres pool — engine running in in-memory or sqlite mode",
            );
          }
          const ec = edition.resolveEngineConfig(cfg, api) as {
            databaseUrl?: string;
            qdrantUrl?: string;
            valkeyUrl?: string;
          };
          const ctx: UiRouterContext = {
            pool: pool as unknown as UiRouterContext["pool"],
            engine: engine as unknown as UiRouterContext["engine"],
            userId,
            engineConfig: ec,
            teiUrl: process.env.TEI_URL ?? "http://127.0.0.1:8080",
            plugin: {
              id: edition.id,
              version: edition.pluginVersion ?? "0.0.0",
              edition: (edition.id.endsWith("-lite") ? "lite" : "hard") as "hard" | "lite",
            },
            installedAt: process.env.CELIUMS_PLUGIN_INSTALLED_AT,
            agentId: cfg.agentId,
            ethicsMode: (cfg as { ethics?: { mode?: string } }).ethics?.mode ?? "radar",
            logger: {
              info: (m: string) => api.logger.info(`${edition.id}: ui: ${m}`),
              warn: (m: string) => api.logger.warn?.(`${edition.id}: ui: ${m}`),
            },
          };
          uiRouterCache = makeUiRouter(ctx);
          return uiRouterCache;
        };
        api.registerHttpRoute({
          path: "/api/celiums-cognition",
          match: "prefix",
          auth: "plugin",
          handler: async (req, res) => {
            try {
              const router = await ensureRouter();
              await router.apiPrefix(req, res);
            } catch (err) {
              if (!res.headersSent) {
                res.statusCode = 503;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    error: {
                      code: "UI_ROUTER_UNAVAILABLE",
                      message: err instanceof Error ? err.message : String(err),
                    },
                  }),
                );
              }
            }
          },
        });
        api.logger.info(`${edition.id}: HTTP routes mounted at /api/celiums-cognition/*`);

        // Static SPA handler — serves index.html, the Vite-built assets,
        // and the SVG logos under /plugins/celiums-cognition/*.
        if (edition.uiStaticDir) {
          const staticHandler = makeUiStaticHandler({
            rootDir: edition.uiStaticDir,
            pathPrefix: "/plugins/celiums-cognition",
            logger: { warn: (m: string) => api.logger.warn?.(`${edition.id}: ${m}`) },
          });
          api.registerHttpRoute({
            path: "/plugins/celiums-cognition",
            match: "prefix",
            auth: "plugin",
            handler: staticHandler,
          });
          api.logger.info(
            `${edition.id}: SPA mounted at /plugins/celiums-cognition/ (serving from ${edition.uiStaticDir})`,
          );
        }
      }

      api.registerCli(
        async ({ program }: { program: { command: (n: string) => unknown } }) => {
          const cmd = program.command(edition.id) as {
            description: (d: string) => { action: (fn: () => void) => void };
          };
          cmd
            .description("Celiums Cognition status")
            .action(() => {
              // eslint-disable-next-line no-console
              console.log(
                `${edition.name} — userId=${userId} exposedTools=${cfg.exposedTools} ethics=${cfg.ethics.enabled}`,
              );
            });
        },
        { descriptors: [{ name: edition.id, description: "Celiums Cognition", hasSubcommands: false }] },
      );

      api.logger.info(`celiums-cognition: ${edition.id} registered`);
    },
  });
}

function safeRegex(src: string): RegExp | undefined {
  try {
    return new RegExp(src, "i");
  } catch {
    return undefined;
  }
}
