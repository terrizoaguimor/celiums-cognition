/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Autonomy + channel surface — Fase F.
//
// Three pieces wired here:
//   (1) heartbeat_prompt_contribution — proactive ticks see a state
//       snapshot, not a fabricated result (doctrine G2).
//   (2) tool_result_persist — auto-trace tool outcomes with throttled
//       writes during loops (I5).
//   (3) inbox enqueue — capture api.enqueueNextTurnInjection into the
//       plugin context so the /inbox/inject HTTP endpoint can use it.
//       Channels external to this plugin push through the mailbox;
//       nothing flows directly into UI or shared state (G4).

import {
  composeHeartbeatSnapshot,
  decideToolResultJournal,
  writeToolResultJournal,
  type AutonomyDeps,
  type EnqueueNextTurnInjectionFn,
} from "../autonomy.js";
import { deriveEthicsMode } from "../../config-schema/index.js";
import type { PluginContext } from "../context.js";

export function wireAutonomyHooks(ctx: PluginContext): void {
  const { api, cfg, userId, getEngine, extractEnginePool, gateReady, isReady, inboxEnqueueRef } = ctx;

  const autonomyDeps: AutonomyDeps = {
    getEngine,
    extractPool: extractEnginePool as never,
    userId,
    agentId: cfg.agentId,
    ethicsMode: deriveEthicsMode(cfg),
    logger: {
      info: (m: string) => api.logger.info(m),
      warn: (m: string) => api.logger.warn?.(m),
    },
  };

  // ── (1) Heartbeat snapshot ──
  api.on(
    "heartbeat_prompt_contribution",
    async (event: { sessionKey?: string; heartbeatName?: string }, hookCtx: { agentId?: string }) => {
      if (!gateReady()) return undefined;
      try {
        const snapshot = await composeHeartbeatSnapshot({
          ...autonomyDeps,
          agentId: hookCtx?.agentId ?? autonomyDeps.agentId,
        });
        if (!snapshot) return undefined;
        api.logger.info(
          `celiums-cognition: heartbeat snapshot · ${(event.heartbeatName ?? "default")} · agent=${hookCtx?.agentId ?? autonomyDeps.agentId}`,
        );
        return { prependContext: snapshot };
      } catch (err) {
        api.logger.warn?.(
          `celiums-cognition: heartbeat snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
      }
    },
  );

  // ── (2) tool_result_persist — hot path, sync decision + detached write ──
  api.on(
    "tool_result_persist",
    (event: { toolName?: string; toolCallId?: string; isSynthetic?: boolean }, hookCtx: { agentId?: string }) => {
      if (!isReady()) return undefined; // hot path: skip warn log
      const aid = hookCtx?.agentId ?? autonomyDeps.agentId;
      const decision = decideToolResultJournal(aid, event);
      if (!decision) return undefined;
      // Fire-and-forget: do not await; tool persistence path is hot.
      void writeToolResultJournal(
        { ...autonomyDeps, agentId: aid },
        decision,
      ).catch(() => { /* logged inside writer */ });
      return undefined;
    },
  );

  // ── (3) Capture enqueueNextTurnInjection for the inbox endpoint ──
  const enqueueOnApi = (
    api as unknown as { enqueueNextTurnInjection?: EnqueueNextTurnInjectionFn }
  ).enqueueNextTurnInjection;
  if (typeof enqueueOnApi === "function") {
    inboxEnqueueRef.current = enqueueOnApi.bind(api) as EnqueueNextTurnInjectionFn;
    api.logger.info(
      `celiums-cognition: inbox bridge ready (enqueueNextTurnInjection captured)`,
    );
  } else {
    api.logger.warn?.(
      `celiums-cognition: api.enqueueNextTurnInjection not available — /inbox/inject will return 503`,
    );
  }
}
