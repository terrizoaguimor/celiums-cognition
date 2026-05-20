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
  type CeliumsMemoryConfig,
  type MemoryEngineWithStore,
  type ModuleStore,
} from "@celiumsai/cognition-engine";
import { parseConfig, type CognitionConfig } from "../config-schema/index.js";
import { selectTools, CURATED_TOOL_NAMES, type EngineToolLike } from "../tool-curator/index.js";

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

/** Best-effort extraction of the latest user-authored text from a messages array. */
function latestUserText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (!m || m.role !== "user") continue;
    const c = m.content;
    if (typeof c === "string" && c.trim()) return c;
    if (Array.isArray(c)) {
      const text = c
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text ?? "")
            : "",
        )
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return undefined;
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
      const extractEnginePool = (
        engine: MemoryEngineWithStore,
      ): { query: (sql: string, params?: unknown[]) => Promise<unknown> } | undefined => {
        const store = engine._store as { pg?: { query: (sql: string, params?: unknown[]) => Promise<unknown> } } | undefined;
        return store?.pg;
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

      // ── Auto-recall (before_prompt_build → prependContext) ─────────────
      if (cfg.autoRecall.enabled) {
        api.on("before_prompt_build", async (event: { prompt?: string; messages?: unknown }) => {
          const q = (latestUserText(event.messages) ?? event.prompt ?? "").trim();
          if (q.length < 5 || (trivialSkip && trivialSkip.test(q))) return undefined;
          try {
            const engine = await getEngine();
            const recalled = await withTimeout(
              engine.recall({ query: q, userId, limit: 5 }),
              AUTO_RECALL_TIMEOUT_MS,
            );
            if (!recalled || !recalled.memories?.length || !recalled.assembledContext) {
              return undefined;
            }
            api.logger.info?.(
              `celiums-cognition: injecting ${recalled.memories.length} memories`,
            );
            return { prependContext: recalled.assembledContext };
          } catch (err) {
            api.logger.warn(`celiums-cognition: auto-recall failed: ${String(err)}`);
            return undefined;
          }
        });
      }

      // ── Auto-capture (agent_end → engine.store) ────────────────────────
      if (cfg.autoCapture.enabled) {
        api.on(
          "agent_end",
          async (
            event: { success?: boolean; messages?: unknown },
            ctx: { sessionKey?: string; sessionId?: string },
          ) => {
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
            return;
          }
          api.logger.info(
            `${edition.id}: bootstrap — ${down.map((d) => `${d.name}:${d.port}`).join(", ")} not responding; running setup…`,
          );
          try {
            await edition.bootstrap(engineCfg, api);
            api.logger.info(`${edition.id}: ready (bootstrap completed)`);
            await runMigrations(edition, ec, api);
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
