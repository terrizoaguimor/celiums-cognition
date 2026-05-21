/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Operator actions — the slash-command + side-button surface the operator
// invokes directly, bypassing the agent. Five actions:
//
//   celiums.remember   write a memory operator-side
//   celiums.recall     semantic search (top-5 by default)
//   celiums.limbic     current PAD + circadian snapshot
//   celiums.forget     delete a memory; requires double-press (U6)
//   celiums.status     four metrics that drive the cognition widget
//
// Doctrine citations (docs/celiums-cognition-doctrine.md):
//   - T3: actions declared as data (id + description + schema + handler),
//         metadata pure, handler lazy via factory
//   - U4: forget is a typed permission request with mandatory `reason`
//   - U5: status surfaces exactly four critical metrics, not twenty
//   - U6: forget arms on first call, executes on confirm within a window
//   - G2: recall result never fabricates — empty hits cite the recovery
//         path explicitly
//
// SDK shape (verified against openclaw@2026.5.19-beta.1
// index-BHaNdiKe.d.ts:80-107):
//   PluginSessionActionContext = { pluginId, actionId, sessionKey?, payload?, client? }
//   PluginSessionActionResult  = { ok: true, result?, reply?, continueAgent? }
//                              | { ok: false, error, code?, details? }
//   PluginSessionActionRegistration = { id, description?, schema?, requiredScopes?, handler }

import { randomBytes } from "node:crypto";
import { type MemoryEngineWithStore } from "@celiumsai/cognition-engine";

// ─── types mirroring SDK shapes (kept local — see Fase B sdk-contracts) ─

export interface OperatorActionContext {
  pluginId: string;
  actionId: string;
  sessionKey?: string;
  payload?: unknown;
  client?: { connId?: string; scopes: string[] };
}

export type OperatorActionResult =
  | { ok: true; result?: unknown; reply?: unknown; continueAgent?: boolean }
  | { ok: false; error: string; code?: string; details?: unknown };

export interface OperatorAction {
  id: string;
  description?: string;
  schema?: unknown;
  handler: (ctx: OperatorActionContext) => Promise<OperatorActionResult>;
}

export type { PoolLike } from "./shared-types.js";
import type { PoolLike } from "./shared-types.js";

export interface ActionDeps {
  getEngine: () => Promise<MemoryEngineWithStore>;
  extractPool: (engine: MemoryEngineWithStore) => PoolLike | undefined;
  userId: string;
  agentId: string;
  ethicsMode?: string;
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}

// ─── double-press tracker (U6) ─────────────────────────────────────────

interface PendingConfirmation {
  action: string;
  payload: Record<string, unknown>;
  token: string;
  expiresAt: number;
}

const pending = new Map<string, PendingConfirmation>();
const CONFIRM_WINDOW_MS = 10_000;

/** Pending-confirmation key. Audit P1 #17: previously keyed by
 *  (sessionKey, action) alone, so two concurrent first-presses for
 *  the same action with DIFFERENT memory_ids would race — the second
 *  overwrote the first's token and the operator could end up
 *  confirming memory A with the token armed for memory B. Including
 *  the target id (or the schema-validated payload identifier) makes
 *  each (caller, action, target) tuple its own bucket — no race. */
function pendingKey(
  sessionKey: string | undefined,
  action: string,
  targetId: string,
): string {
  return `${sessionKey ?? "_global"}:${action}:${targetId}`;
}

function sweepPending(): void {
  const now = Date.now();
  for (const [k, p] of pending) {
    if (p.expiresAt < now) pending.delete(k);
  }
}

/** Test/teardown hook. */
export function _resetOperatorActions(): void {
  pending.clear();
}

// ─── shared helpers ────────────────────────────────────────────────────

function shortId(id: string, n = 12): string {
  return id.length > n ? `${id.slice(0, n)}…` : id;
}

/** Format a recall result string. G2: when zero hits, name the recovery
 *  path so the operator can try a different query without guessing. */
function formatRecallResult(
  hits: Array<{ id: string; content: string; importance?: number }>,
  query: string,
): string {
  if (hits.length === 0) {
    return (
      `No memories matched "${query}". ` +
      `Try a broader query, or use \`celiums.recall\` with limit=20, ` +
      `or call \`journal_recall\` to scan first-person entries instead.`
    );
  }
  const lines: string[] = [`${hits.length} memories matched "${query}":`];
  for (const [i, h] of hits.entries()) {
    const snippet = String(h.content ?? "").slice(0, 160);
    const tail = snippet.length >= 160 ? "…" : "";
    const imp = typeof h.importance === "number"
      ? ` · importance=${h.importance.toFixed(2)}`
      : "";
    lines.push(`${i + 1}. \`${shortId(h.id, 8)}\`${imp} — ${snippet}${tail}`);
  }
  return lines.join("\n");
}

// ─── action: celiums.remember ──────────────────────────────────────────

export function makeRememberAction(deps: ActionDeps): OperatorAction {
  return {
    id: "celiums.remember",
    description:
      "Save a memory operator-side, bypassing the agent. Use for facts " +
      "you want the agent to recall in future turns without having to " +
      "say them again.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: { type: "string", minLength: 1 },
        tags: { type: "array", items: { type: "string" } },
        importance: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["content"],
    },
    async handler(ctx) {
      const payload =
        (ctx.payload ?? {}) as { content?: string; tags?: string[]; importance?: number };
      if (!payload.content) {
        return { ok: false, error: "content required", code: "INVALID_PAYLOAD" };
      }
      try {
        const engine = await deps.getEngine();
        const stored = (await engine.store([
          {
            content: payload.content,
            userId: deps.userId,
            importance: payload.importance ?? 0.8,
            ...(payload.tags ? { tags: payload.tags } : {}),
          } as never,
        ])) as Array<{ id: string }>;
        const id = stored[0]?.id ?? "unknown";
        deps.logger?.info?.(
          `operator-action: celiums.remember saved ${shortId(id, 8)}`,
        );
        return {
          ok: true,
          reply: `Saved as \`${shortId(id, 8)}\`.`,
          result: { id, importance: payload.importance ?? 0.8 },
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ENGINE_ERROR",
        };
      }
    },
  };
}

// ─── action: celiums.recall ────────────────────────────────────────────

export function makeRecallAction(deps: ActionDeps): OperatorAction {
  return {
    id: "celiums.recall",
    description:
      "Semantic search across stored memories. Returns top-5 by default; " +
      "limit can go to 20.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1 },
        limit: { type: "number", minimum: 1, maximum: 20 },
      },
      required: ["query"],
    },
    async handler(ctx) {
      const payload = (ctx.payload ?? {}) as { query?: string; limit?: number };
      if (!payload.query) {
        return { ok: false, error: "query required", code: "INVALID_PAYLOAD" };
      }
      try {
        const engine = await deps.getEngine() as unknown as {
          recall: (
            q: string,
            opts: { userId: string; limit?: number },
          ) => Promise<Array<{ id: string; content: string; importance?: number }>>;
        };
        const hits = await engine.recall(payload.query, {
          userId: deps.userId,
          limit: payload.limit ?? 5,
        });
        return {
          ok: true,
          reply: formatRecallResult(hits, payload.query),
          result: {
            count: hits.length,
            hits: hits.map((h) => ({
              id: h.id,
              content: h.content.slice(0, 200),
              importance: h.importance,
            })),
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ENGINE_ERROR",
        };
      }
    },
  };
}

// ─── action: celiums.limbic ────────────────────────────────────────────

export function makeLimbicAction(deps: ActionDeps): OperatorAction {
  return {
    id: "celiums.limbic",
    description: "Current PAD (pleasure/arousal/dominance) and circadian state.",
    schema: { type: "object", additionalProperties: false, properties: {} },
    async handler(_ctx) {
      try {
        const engine = (await deps.getEngine()) as unknown as {
          getLimbicState?: (uid: string) => Promise<Record<string, unknown> | null>;
          getCircadianTelemetry?: (uid: string) => Promise<Record<string, unknown> | null>;
        };
        if (!engine.getLimbicState || !engine.getCircadianTelemetry) {
          return {
            ok: false,
            error: "limbic surface not exposed on this engine build",
            code: "UNAVAILABLE",
          };
        }
        const [state, telemetry] = await Promise.all([
          engine.getLimbicState(deps.userId),
          engine.getCircadianTelemetry(deps.userId),
        ]);
        return {
          ok: true,
          result: {
            pad: state
              ? {
                  P: Number(state.pleasure ?? 0),
                  A: Number(state.arousal ?? 0),
                  D: Number(state.dominance ?? 0),
                }
              : null,
            circadian: telemetry
              ? {
                  time_of_day: String(telemetry.timeOfDay ?? ""),
                  local_hour: Number(telemetry.localHour ?? 0),
                  rhythm: Number(telemetry.rhythmComponent ?? 0),
                  arousal_after_regulation: Number(
                    telemetry.arousalAfterRegulation ?? 0,
                  ),
                }
              : null,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ENGINE_ERROR",
        };
      }
    },
  };
}

// ─── action: celiums.forget (destructive, U6 double-press) ─────────────

export function makeForgetAction(deps: ActionDeps): OperatorAction {
  return {
    id: "celiums.forget",
    description:
      "Delete a memory by id. Requires a reason and a second confirmation " +
      "press within 10 seconds. The deletion is logged to the journal " +
      "with the reason for audit.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        memory_id: { type: "string", minLength: 8 },
        reason: { type: "string", minLength: 1 },
        confirm: { type: "boolean" },
      },
      required: ["memory_id", "reason"],
    },
    async handler(ctx) {
      const payload =
        (ctx.payload ?? {}) as { memory_id?: string; reason?: string; confirm?: boolean };
      if (!payload.memory_id) {
        return { ok: false, error: "memory_id required", code: "INVALID_PAYLOAD" };
      }
      if (!payload.reason) {
        return { ok: false, error: "reason required", code: "INVALID_PAYLOAD" };
      }
      sweepPending();
      // Include the memory_id in the key so concurrent arms for
      // different memories cannot overwrite each other's tokens.
      const key = pendingKey(ctx.sessionKey, "celiums.forget", payload.memory_id);
      // First press — arm the confirmation.
      if (!payload.confirm) {
        const token = randomBytes(16).toString("base64url");
        pending.set(key, {
          action: "celiums.forget",
          payload: payload as Record<string, unknown>,
          token,
          expiresAt: Date.now() + CONFIRM_WINDOW_MS,
        });
        return {
          ok: false,
          code: "CONFIRMATION_REQUIRED",
          error:
            `Forgetting memory \`${shortId(payload.memory_id)}\` (reason: ${payload.reason}). ` +
            `Re-issue with \`confirm: true\` within ${CONFIRM_WINDOW_MS / 1000}s to proceed.`,
          details: {
            token,
            expires_in_ms: CONFIRM_WINDOW_MS,
            memory_id: payload.memory_id,
            reason: payload.reason,
          },
        };
      }
      // Second press — verify and execute.
      const armed = pending.get(key);
      if (!armed || armed.payload.memory_id !== payload.memory_id) {
        return {
          ok: false,
          error:
            "No pending forget for this memory_id (window expired or memory_id changed). " +
            "Press again without `confirm: true` to re-arm.",
          code: "NOT_ARMED",
        };
      }
      pending.delete(key);
      try {
        const engine = (await deps.getEngine()) as unknown as {
          delete?: (ids: string[], opts: { userId: string }) => Promise<unknown>;
        };
        if (!engine.delete) {
          return {
            ok: false,
            error: "engine.delete not exposed",
            code: "UNAVAILABLE",
          };
        }
        await engine.delete([payload.memory_id], { userId: deps.userId });
        // Audit trail (best-effort). Operator-direct actions are tagged
        // distinctly from agent-driven ones (G3: rules layered by source).
        try {
          const pool = deps.extractPool(await deps.getEngine());
          if (pool) {
            await pool.query(
              `INSERT INTO agent_journal
                 (agent_id, entry_type, content, valence, valence_reason, tags, visibility)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                deps.agentId,
                "decision",
                `Operator deleted memory \`${payload.memory_id}\` via celiums.forget. Reason: ${payload.reason}`,
                -0.1,
                "operator-direct forget",
                ["operator-action", "forget", "destructive"],
                "self",
              ],
            );
          }
        } catch {
          // Audit-trail write is best-effort; the deletion already happened.
        }
        deps.logger?.info?.(
          `operator-action: celiums.forget executed ${shortId(payload.memory_id)} — reason: ${payload.reason}`,
        );
        return {
          ok: true,
          reply: `Forgot \`${shortId(payload.memory_id)}\`.`,
          result: { memory_id: payload.memory_id, reason: payload.reason },
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ENGINE_ERROR",
        };
      }
    },
  };
}

// ─── action: celiums.status (drives the control UI widget) ─────────────

export interface CognitionStatus {
  /** Approximate context-window fill, when the engine can compute it. */
  context_usage_pct: number | null;
  /** Most-recent journal hash for this agent, the continuity anchor. */
  journal_head: {
    id: string;
    hash: string;
    written_at: string;
  } | null;
  /** Active ethics mode (radar | enforce | silent | off, plugin-specific). */
  ethics_mode: string;
  /** Memories the most-recent turn pulled into context, when known. */
  recall_count_last_turn: number | null;
}

/** Compute the four U5 metrics. Shared between the celiums.status action
 *  and the /api/celiums-cognition/operator-status HTTP endpoint so the
 *  shell widget and the dashboard show identical values. */
export async function computeCognitionStatus(
  deps: ActionDeps,
): Promise<CognitionStatus> {
  const engine = await deps.getEngine();
  const pool = deps.extractPool(engine);
  let journal_head: CognitionStatus["journal_head"] = null;
  if (pool) {
    try {
      const r = await pool.query(
        `SELECT id, hash, written_at
           FROM agent_journal
          WHERE agent_id = $1
          ORDER BY written_at DESC
          LIMIT 1`,
        [deps.agentId],
      );
      if (r.rows[0]) {
        const w = r.rows[0].written_at;
        journal_head = {
          id: String(r.rows[0].id),
          hash: String(r.rows[0].hash),
          written_at:
            w instanceof Date ? w.toISOString() : String(w ?? ""),
        };
      }
    } catch {
      // agent_journal may be missing on a half-bootstrapped gateway —
      // surface null, the widget shows "—" instead of crashing.
    }
  }
  // context_usage_pct + recall_count_last_turn require gateway-side
  // signals we don't yet receive. Left null per doctrine G2 — better a
  // visible "—" than a fabricated number.
  return {
    context_usage_pct: null,
    journal_head,
    ethics_mode: deps.ethicsMode ?? "radar",
    recall_count_last_turn: null,
  };
}

export function makeStatusAction(deps: ActionDeps): OperatorAction {
  return {
    id: "celiums.status",
    description:
      "Current cognitive snapshot: context usage, journal head, ethics mode, " +
      "recall count for the last turn. Drives the Cognition shell widget.",
    schema: { type: "object", additionalProperties: false, properties: {} },
    async handler(_ctx) {
      try {
        const status = await computeCognitionStatus(deps);
        return { ok: true, result: status };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "ENGINE_ERROR",
        };
      }
    },
  };
}

// ─── descriptor for registerControlUiDescriptor ────────────────────────

/** Declarative metadata for the cognition status widget. Surface
 *  "session" because the data is per-conversation; the shell renders it
 *  in whatever placement it picks (footer chip, side panel, status bar).
 *  Verified shape against index-BHaNdiKe.d.ts:71-79. */
export const COGNITION_STATUS_DESCRIPTOR = {
  id: "celiums-cognition.status",
  surface: "session" as const,
  label: "Cognition",
  description:
    "Memory, journal, ethics, limbic — live operator-side snapshot of " +
    "the cognitive plugin. Updates each turn.",
  schema: {
    type: "object",
    properties: {
      context_usage_pct: { type: ["number", "null"] },
      journal_head: {
        type: ["object", "null"],
        properties: {
          id: { type: "string" },
          hash: { type: "string" },
          written_at: { type: "string" },
        },
      },
      ethics_mode: { type: "string" },
      recall_count_last_turn: { type: ["number", "null"] },
    },
  },
} as const;

// ─── full action list (factory) ────────────────────────────────────────

export function buildOperatorActions(deps: ActionDeps): OperatorAction[] {
  return [
    makeRememberAction(deps),
    makeRecallAction(deps),
    makeLimbicAction(deps),
    makeForgetAction(deps),
    makeStatusAction(deps),
  ];
}
