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

import { definePluginEntry, type OpenClawPluginApi } from "../api.js";
import {
  createMemoryEngine,
  buildRegistry,
  ethics,
  type CeliumsMemoryConfig,
  type MemoryEngineWithStore,
} from "@celiumsai/cognition-engine";
import { parseConfig, type CognitionConfig } from "../config-schema/index.js";
import { selectTools, type EngineToolLike } from "../tool-curator/index.js";

/** Per-edition wiring supplied by packages/hard and packages/lite. */
export interface EditionOptions {
  id: string;
  name: string;
  description: string;
  /** Declarative+runtime config schema (BASE merged with edition keys). */
  configSchema: unknown;
  /** Map plugin config → engine config (Hard: PG/Qdrant/Valkey URLs; Lite: pglite). */
  resolveEngineConfig: (cfg: CognitionConfig, api: OpenClawPluginApi) => CeliumsMemoryConfig;
}

const AUTO_RECALL_TIMEOUT_MS = 4_000;

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
                const res = (await tool.handler(
                  (params ?? {}) as Record<string, unknown>,
                  { ...toolCtx(), memoryEngine: engine },
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
          { name: tool.definition.name },
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
      api.registerService({
        id: edition.id,
        start: () => {
          api.logger.info(`${edition.id}: ready (engine init is lazy)`);
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
