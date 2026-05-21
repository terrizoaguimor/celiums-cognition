/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Proactive turn-context (before_prompt_build → prependContext).
//
// Mario's call 2026-05-21: "el plugin se vuelve el ADN del software".
// The agent shouldn't have to *decide* to call turn_context — the
// 8 channels (identity priors + continuity briefing + auto-recalled
// memory + forage corpus + ethics-advisory + epistemic-flag +
// suggestion-intents + limbic PAD state) must be present on every
// turn by default.
//
// Composition order on success:
//   identity preamble  ← who this agent is
//   parent briefing    ← Fase B subagent re-briefing (if applicable)
//   turn_context       ← engine.turnContext() output
//
// Falls back to the older lightweight auto-recall path on any failure
// (turn_context errored, engine unavailable, pool missing) — a turn
// must NEVER be blocked by this hook.

import {
  withShapeValidation, BEFORE_PROMPT_BUILD_EVENT,
} from "../../sdk-contracts.js";
import { buildAgentIdentityPreamble } from "../../prompt-supplement/index.js";
import { resolveAgentId } from "../shared-types.js";
import {
  lookupParent, composeBriefing,
  DEFAULT_SUBAGENT_CONFIG, type SubagentConfig,
} from "../subagent.js";
import type { PluginContext } from "../context.js";

// Local helpers — kept module-scope so the hot path doesn't rebuild
// them on each turn.
const AUTO_RECALL_TIMEOUT_MS = 4500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function latestUserText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (m?.role === "user") {
      const c = m.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        const text = c.map((b) => (b && typeof b === "object" && (b as { text?: string }).text) || "").join(" ").trim();
        if (text) return text;
      }
    }
  }
  return undefined;
}

function safeRegex(src: string): RegExp | undefined {
  try { return new RegExp(src, "i"); } catch { return undefined; }
}

export function wirePromptBuild(ctx: PluginContext): void {
  const { api, cfg, userId, getEngine, extractEnginePool, gateReady } = ctx;
  if (!cfg.autoRecall.enabled) return;

  const trivialSkip = safeRegex(cfg.autoRecall.trivialSkipRegex);
  const subagentCfg: SubagentConfig = DEFAULT_SUBAGENT_CONFIG;

  api.on("before_prompt_build", withShapeValidation(
    BEFORE_PROMPT_BUILD_EVENT,
    async (
      event: { prompt?: string; messages?: unknown; agentId?: string },
      hookCtx: { sessionKey?: string; sessionId?: string; agentId?: string; conversationId?: string },
    ) => {
      if (!gateReady()) return undefined;
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
        const turnCtx = {
          userId,
          capabilities: {
            opencore: true as const,
            fleet: !!process.env.CELIUMS_FLEET_API_KEY,
            atlas: !!process.env.CELIUMS_ATLAS_API_KEY,
            ai: !!process.env.CELIUMS_LLM_API_KEY,
          },
          agentId: resolveAgentId([hookCtx?.agentId, event.agentId], cfg.agentId),
          sessionId: hookCtx?.sessionId ?? hookCtx?.sessionKey,
          conversationId: hookCtx?.conversationId,
          memoryEngine: engine,
          pool,
        };
        // Engine's handler reads args.userMessage (camelCase) even though
        // lib/proactive.ts types it as `user_message`. Pass both.
        const mod = await import("@celiumsai/cognition-engine");
        const turnContext = (mod as { turnContext?: (i: unknown, c: unknown) => Promise<unknown> }).turnContext;
        const tc = (typeof turnContext === "function"
          ? await withTimeout(
              turnContext(
                { user_message: q, userMessage: q, max_chars: 3000 } as never,
                turnCtx as never,
              ),
              AUTO_RECALL_TIMEOUT_MS,
            )
          : null) as { context?: string; total_chars?: number; channels_loaded?: string[] } | null;

        // Identity preamble — tells THIS agent which agent_id owns its
        // journal entries. Cache-unstable but tiny.
        const identityPreamble = buildAgentIdentityPreamble({
          agentId: turnCtx.agentId,
          sessionId: turnCtx.sessionId,
          conversationId: turnCtx.conversationId,
        });
        // Fase B live re-briefing for subagents.
        let parentBriefing = "";
        try {
          const meAsChildAgent = resolveAgentId([turnCtx.agentId, event.agentId], cfg.agentId);
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
          `celiums-cognition: turn_context ${tc.total_chars} chars · channels: ${(tc.channels_loaded ?? []).join(",")} · agent=${turnCtx.agentId}${parentBriefing ? " · with-parent-briefing" : ""}`,
        );
        return {
          prependContext: [identityPreamble, parentBriefing, tc.context]
            .filter((s) => s && s.length > 0)
            .join("\n\n"),
        };
      } catch (err) {
        api.logger.warn?.(`celiums-cognition: turn_context failed (${String(err)}); falling back to recall-only`);
        try {
          const engine = await getEngine();
          const recalled = await withTimeout(
            engine.recall({ query: q, userId, limit: 5 }),
            AUTO_RECALL_TIMEOUT_MS,
          );
          if (!recalled?.memories?.length || !recalled.assembledContext) return undefined;
          return { prependContext: recalled.assembledContext };
        } catch (err2) {
          api.logger.warn?.(`celiums-cognition: recall fallback also failed: ${String(err2)}`);
          return undefined;
        }
      }
    },
    { warn: (m) => api.logger.warn?.(m) },
  ));
}

// Re-export the message helpers because the agent-end hooks use them.
export { latestUserText };
