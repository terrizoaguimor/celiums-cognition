/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Operator-facing REST endpoints introduced by Fase D + Fase F.
// Extracted from ui-routes.ts (doctrine A1).
//
//   POST /api/celiums-cognition/inbox/inject   — mailbox bridge (Fase F, G4)
//   GET  /api/celiums-cognition/operator-status — cognition widget metrics (Fase D, U5)

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendJson,
  sendError,
  sanitizeDbError,
  type UiRouterContext,
} from "./utils.js";

/** Mailbox bridge for inbound channels (Fase F, doctrine G4). External
 *  plugins or services that own a channel adapter (Telegram, Slack,
 *  webhook, etc.) POST a JSON body here to enqueue a note that the
 *  target session sees at the top of its next turn.
 *
 *  Body: { sessionKey, text, idempotencyKey?, placement?, channel?, ttlMs? }
 *
 *  Returns 503 when the gateway lacks `api.enqueueNextTurnInjection`
 *  (older builds) so the caller can fall back gracefully. */
export async function inboxInject(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    return sendError(res, 405, "METHOD_NOT_ALLOWED", `${req.method} not allowed`);
  }
  if (!ctx.inboxEnqueue) {
    return sendError(
      res,
      503,
      "UNAVAILABLE",
      "gateway does not expose enqueueNextTurnInjection on this build",
    );
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  // 64 KB cap on inbox bodies — channel notices should be short.
  if (body.length > 64 * 1024) {
    return sendError(res, 413, "PAYLOAD_TOO_LARGE", "body exceeds 64 KB");
  }
  let payload: {
    sessionKey?: unknown;
    text?: unknown;
    idempotencyKey?: unknown;
    placement?: unknown;
    channel?: unknown;
    ttlMs?: unknown;
  };
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    return sendError(res, 400, "INVALID_JSON", "request body is not valid JSON");
  }
  if (typeof payload.sessionKey !== "string" || !payload.sessionKey) {
    return sendError(res, 400, "INVALID_PAYLOAD", "sessionKey (string) required");
  }
  if (typeof payload.text !== "string" || !payload.text) {
    return sendError(res, 400, "INVALID_PAYLOAD", "text (string) required");
  }
  const placement =
    payload.placement === "append_context" ? "append_context" : "prepend_context";
  try {
    const result = await ctx.inboxEnqueue({
      sessionKey: payload.sessionKey,
      text: payload.text,
      ...(typeof payload.idempotencyKey === "string"
        ? { idempotencyKey: payload.idempotencyKey }
        : {}),
      placement,
      ...(typeof payload.ttlMs === "number" ? { ttlMs: payload.ttlMs } : {}),
      metadata: {
        source: "celiums-cognition.inbox",
        ...(typeof payload.channel === "string" && payload.channel
          ? { channel: payload.channel }
          : {}),
      },
    });
    sendJson(res, 200, {
      ok: true,
      enqueued: result.enqueued,
      id: result.id,
      session_key: result.sessionKey,
    });
  } catch (err) {
    // Doctrine G1: reason is plugin-local; message must not leak
    // gateway-internal detail to wire. Logger keeps the verbose trace
    // for operator audit.
    ctx.logger?.warn?.(
      `inbox/inject enqueue failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    sendError(res, 500, "ENQUEUE_FAILED", "enqueue failed");
  }
}

/** Returns the four cognition metrics surfaced by Fase D's control UI
 *  descriptor: context usage %, journal head (id+hash+time), ethics
 *  mode, recall count for last turn. The same payload is returned by
 *  the `celiums.status` session action so the shell widget and the
 *  dashboard widget read identical values.
 *
 *  context_usage_pct and recall_count_last_turn are null when the host
 *  hasn't supplied the underlying signals (G2: a visible "—" beats a
 *  fabricated number). */
export async function operatorStatus(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const agentId = ctx.agentId ?? "celiums-cognition";
  const ethicsMode = ctx.ethicsMode ?? "radar";
  let journal_head:
    | { id: string; hash: string; written_at: string }
    | null = null;
  try {
    const { rows } = await ctx.pool.query(
      `SELECT id, hash, written_at
         FROM agent_journal
        WHERE agent_id = $1
        ORDER BY written_at DESC
        LIMIT 1`,
      [agentId],
    );
    if (rows[0]) {
      const w = rows[0].written_at;
      journal_head = {
        id: String(rows[0].id),
        hash: String(rows[0].hash),
        written_at: w instanceof Date ? w.toISOString() : String(w ?? ""),
      };
    }
  } catch (err) {
    return sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
  sendJson(res, 200, {
    context_usage_pct: null,
    journal_head,
    ethics_mode: ethicsMode,
    recall_count_last_turn: null,
  });
}
