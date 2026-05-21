/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Compaction wiring — Fase A of the transversal roadmap.
//
// Two pieces:
//   (1) registerCompactionProvider — the heavy work. Persists worth-
//       saving facts from about-to-drop messages as memories, writes
//       an `arc` journal entry tagged ["compaction","auto"], returns
//       a structured summary the next turn can read. The slot is NOT
//       exclusive (registry keys by id) so we coexist with memory-core.
//   (2) before_compaction + after_compaction observation hooks. Pure
//       logging — they record WHEN compactions happen so the journal
//       can correlate other entries with context-rotation events.
//       Wrapped with withShapeValidation so an SDK shape change
//       degrades to a warn+skip instead of crashing the agent turn.

import { makeCeliumsCompactionProvider, type CompactionProvider } from "../compaction.js";
import { withShapeValidation, BEFORE_COMPACTION_EVENT } from "../../sdk-contracts.js";
import { resolveAgentId } from "../shared-types.js";
import type { PluginContext } from "../context.js";

export function wireCompaction(ctx: PluginContext): void {
  const { api, cfg } = ctx;

  // ── provider ──
  try {
    const maybeReg = (api as unknown as {
      registerCompactionProvider?: (p: CompactionProvider) => void;
    }).registerCompactionProvider;
    if (typeof maybeReg === "function") {
      const provider = makeCeliumsCompactionProvider({
        getEngine: ctx.getEngine,
        extractPool: ctx.extractEnginePool as never,
        userId: ctx.userId,
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

  // ── observation hooks ──
  api.on(
    "before_compaction",
    withShapeValidation(
      BEFORE_COMPACTION_EVENT,
      async (
        event: { messageCount?: number; tokenCount?: number },
        hookCtx: { agentId?: string; sessionId?: string },
      ) => {
        api.logger.info(
          `celiums-cognition: before_compaction · agent=${resolveAgentId([hookCtx?.agentId], cfg.agentId)} · ${event.messageCount ?? "?"} msgs · ${event.tokenCount ?? "?"} tokens`,
        );
        return undefined;
      },
      { warn: (m) => api.logger.warn?.(m) },
    ),
  );

  api.on(
    "after_compaction",
    async (
      _event: unknown,
      hookCtx: { agentId?: string; sessionId?: string },
    ) => {
      api.logger.info(
        `celiums-cognition: after_compaction · agent=${resolveAgentId([hookCtx?.agentId], cfg.agentId)}`,
      );
    },
  );
}
