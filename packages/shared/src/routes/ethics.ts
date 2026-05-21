/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Ethics audit-log entries paginated for the Ethics tab.

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendJson, sendError, parseQuery, paginate, sanitizeDbError,
  type UiRouterContext,
} from "./utils.js";

/** ?decision=block|flag|allow|all  ?law=1|2|3 (Three Laws) optional. */
export async function ethicsEvents(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { limit, offset } = paginate(req);
  const q = parseQuery(req);
  const decision = (q.get("decision") ?? "all").toLowerCase();
  const law = q.get("law");
  try {
    const where: string[] = [];
    const params: unknown[] = [];
    if (decision === "block" || decision === "flag" || decision === "allow") {
      params.push(decision);
      where.push(`final_decision = $${params.length}`);
    } else if (decision === "blocked") {
      where.push(`blocked = true`);
    }
    if (law && /^[123]$/.test(law)) {
      params.push(parseInt(law, 10));
      where.push(`law_violated = $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit, offset);
    const { rows } = await ctx.pool.query(
      `SELECT id, created_at, user_id, law_violated, confidence, reason,
              action_attempted, blocked, content_hash, detected_categories,
              scores, final_decision
         FROM ethics_audit ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const { rows: countRows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM ethics_audit ${whereSql}`,
      params.slice(0, params.length - 2),
    );
    sendJson(res, 200, {
      events: rows,
      total: countRows[0]?.n ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}
