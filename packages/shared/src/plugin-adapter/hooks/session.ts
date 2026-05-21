/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Session lifecycle hooks — Fase C of the transversal roadmap.
// session_start anchors a thread (optionally resumed); session_end
// closes it with a deterministic summary. Both scope journal entries
// to conversation_id = sessionId so /journal/recent?conversation_id=…
// renders them grouped without UI changes.

import {
  withShapeValidation,
  SESSION_START_EVENT, SESSION_END_EVENT,
} from "../../sdk-contracts.js";
import {
  rememberSessionStart, consumeSessionEnd, composeSessionEndSummary,
  emitSessionJournal, DEFAULT_SESSION_CONFIG, type SessionConfig,
} from "../sessions.js";
import { resolveAgentId } from "../shared-types.js";
import { TAG_SESSION_END, tagSessionReason } from "../journal-tags.js";
import type { PluginContext } from "../context.js";

export function wireSessionHooks(ctx: PluginContext): void {
  const { api, cfg, userId, getEngine, extractEnginePool, gateReady } = ctx;
  const sessionCfg: SessionConfig = DEFAULT_SESSION_CONFIG;

  // ── (1) session_start ──
  api.on(
    "session_start",
    withShapeValidation(
      SESSION_START_EVENT,
      async (
        event: { sessionId: string; sessionKey?: string; resumedFrom?: string },
        hookCtx: { agentId?: string; sessionId?: string; sessionKey?: string },
      ) => {
        if (!gateReady()) return undefined;
        try {
          const engine = await getEngine();
          const pool = extractEnginePool(engine);
          if (!pool) return undefined;
          const effectiveAgent = resolveAgentId([hookCtx?.agentId], cfg.agentId);
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

  // ── (2) session_end ──
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
        if (!gateReady()) return undefined;
        try {
          const engine = await getEngine();
          const pool = extractEnginePool(engine);
          if (!pool) return undefined;
          const tracked = consumeSessionEnd(event.sessionId);
          const effectiveAgent = resolveAgentId([tracked?.agentId, hookCtx?.agentId], cfg.agentId);
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
            tags: [TAG_SESSION_END, tagSessionReason(reasonStr)],
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
}
