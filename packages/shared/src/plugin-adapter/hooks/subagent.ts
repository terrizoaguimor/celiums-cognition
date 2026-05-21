/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Subagent lifecycle hooks — Fase B of the transversal roadmap.
// Three hooks; each wrapped with withShapeValidation so an SDK shape
// drift surfaces as a warn+skip on the FIRST event and the plugin
// keeps running (doctrine G1).

import {
  withShapeValidation,
  SUBAGENT_SPAWN_BASE_EVENT,
  SUBAGENT_ENDED_EVENT,
} from "../../sdk-contracts.js";
import {
  threadKey, getCachedParent,
  insertLineage, closeLineage,
  shouldRefuseSpawn, emitJournal,
  DEFAULT_SUBAGENT_CONFIG, type SubagentConfig,
} from "../subagent.js";
import { resolveAgentId, type PoolLike } from "../shared-types.js";
import {
  TAG_SUBAGENT_REFUSED, TAG_LOOP_GUARD,
  TAG_SPAWNED_SUBAGENT, TAG_SESSION_END,
  TAG_SUBAGENT, tagFromSubagent,
} from "../journal-tags.js";
import type { PluginContext } from "../context.js";

export function wireSubagentHooks(ctx: PluginContext): void {
  const { api, cfg, userId, getEngine, extractEnginePool, gateReady } = ctx;
  const subagentCfg: SubagentConfig = DEFAULT_SUBAGENT_CONFIG;

  // ── (1) subagent_spawning — loop guard + briefing assembly ──
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
        if (!gateReady()) return undefined;
        try {
          const engine = await getEngine();
          const pool = extractEnginePool(engine);
          if (!pool) return undefined;
          const tKey = threadKey(event.requester, hookCtx?.sessionKey);
          const parentEntry = getCachedParent(tKey);
          const parentAgentId = resolveAgentId([parentEntry?.parentAgentId, hookCtx?.agentId], cfg.agentId);
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
              tags: [TAG_SUBAGENT_REFUSED, TAG_LOOP_GUARD],
              conversationId: parentEntry?.conversationId,
            });
            return { status: "error" as const, error: guard.reason };
          }
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
            tags: [TAG_SPAWNED_SUBAGENT, event.agentId],
            conversationId: parentEntry?.conversationId,
          });
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
          return undefined;
        }
      },
      { warn: (m) => api.logger.warn?.(m) },
    ),
  );

  // ── (2) subagent_spawned — observability log ──
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

  // ── (3) subagent_ended — close lineage + retrospective entries ──
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
        if (!gateReady()) return undefined;
        if (event.targetKind !== "subagent") return undefined;
        try {
          const engine = await getEngine();
          const pool = extractEnginePool(engine);
          if (!pool) return undefined;
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
            tags: [TAG_SESSION_END, TAG_SUBAGENT],
            conversationId: lin.conversation_id ?? undefined,
          });
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
            tags: [tagFromSubagent(lin.child_agent_id)],
            conversationId: lin.conversation_id ?? undefined,
          });
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
}
