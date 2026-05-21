/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Memories list with pagination + content ILIKE filter + date bucket.
// Date buckets ("today", "yesterday", "week", "month", "year") are
// resolved against the operator's stored timezone offset so "today"
// matches the operator's local calendar day, not UTC.

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendJson, sendError, parseQuery, paginate, sanitizeDbError,
  type UiRouterContext,
} from "./utils.js";

/** List recent memories, paginated. Optional ?q= filters by content
 *  ILIKE. Single-account → no user_id filter (everything belongs to
 *  the operator). */
export async function memoriesList(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { limit, offset } = paginate(req);
  const params0 = parseQuery(req);
  const q = params0.get("q")?.trim() ?? "";
  const bucket = (params0.get("bucket") ?? "all").toLowerCase();
  const fromIso = params0.get("from") ?? null;
  const toIso = params0.get("to") ?? null;
  try {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q) {
      args.push(`%${q}%`);
      // idx_memories_content_trgm makes ILIKE practical at scale.
      where.push(`content ILIKE $${args.length}`);
    }
    // Date bucket — relative ranges resolved server-side using the
    // user's local timezone (so "today" means today in Bogota, not in UTC).
    if (bucket && bucket !== "all" && bucket !== "custom") {
      let tzOffset = 0;
      try {
        const { rows: prof } = await ctx.pool.query(
          `SELECT timezone_offset FROM user_profiles WHERE user_id = $1 LIMIT 1`,
          [ctx.userId],
        );
        if (prof[0]) tzOffset = Number(prof[0].timezone_offset ?? 0);
      } catch { /* fall back to UTC */ }
      args.push(tzOffset);
      const tzIdx = args.length;
      switch (bucket) {
        case "today":
          where.push(`created_at >= date_trunc('day', now() + ($${tzIdx}::numeric * INTERVAL '1 hour')) - ($${tzIdx}::numeric * INTERVAL '1 hour')`);
          break;
        case "yesterday":
          where.push(`created_at >= date_trunc('day', now() + ($${tzIdx}::numeric * INTERVAL '1 hour')) - INTERVAL '1 day' - ($${tzIdx}::numeric * INTERVAL '1 hour')
            AND created_at < date_trunc('day', now() + ($${tzIdx}::numeric * INTERVAL '1 hour')) - ($${tzIdx}::numeric * INTERVAL '1 hour')`);
          break;
        case "week":
          where.push(`created_at >= now() - INTERVAL '7 days'`);
          args.pop();
          break;
        case "month":
          where.push(`created_at >= now() - INTERVAL '30 days'`);
          args.pop();
          break;
        case "year":
          where.push(`created_at >= now() - INTERVAL '365 days'`);
          args.pop();
          break;
      }
    }
    if (fromIso) {
      args.push(fromIso);
      where.push(`created_at >= $${args.length}::timestamptz`);
    }
    if (toIso) {
      args.push(toIso);
      where.push(`created_at < $${args.length}::timestamptz`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const filterArgs = [...args];
    args.push(limit, offset);
    const { rows } = await ctx.pool.query(
      `SELECT id, user_id, project_id, session_id, content, summary,
              memory_type, scope, importance, emotional_valence,
              emotional_arousal, emotional_dominance, confidence,
              strength, retrieval_count, last_retrieved_at, state,
              tags, created_at, updated_at
         FROM memories ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    const { rows: countRows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM memories ${whereSql}`,
      filterArgs,
    );
    sendJson(res, 200, {
      memories: rows,
      total: countRows[0]?.n ?? 0,
      limit,
      offset,
      bucket: bucket || "all",
    });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}
