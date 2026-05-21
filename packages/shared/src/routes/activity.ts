/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Activity sparklines (24 hourly buckets) + recent unified feed +
// limbic state. Grouped together because they all feed the Overview
// tab's left column.

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendJson, sendError, paginate, sanitizeDbError,
  type UiRouterContext,
} from "./utils.js";

/** 24 hourly buckets (oldest → newest) per stream for sparklines. */
export async function activitySparklines(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // generate_series of hour buckets, left-joined with counts.
  // Returns 24 rows even when a stream is empty. All four run in parallel.
  const bucketSql = (table: string, tsCol: string, extraWhere = ""): string =>
    `WITH buckets AS (
       SELECT generate_series(
                date_trunc('hour', now()) - INTERVAL '23 hours',
                date_trunc('hour', now()),
                INTERVAL '1 hour'
              ) AS bucket_start
     ),
     hits AS (
       SELECT date_trunc('hour', ${tsCol}) AS bucket_start, count(*)::int AS n
         FROM ${table}
        WHERE ${tsCol} >= now() - INTERVAL '24 hours'
          ${extraWhere}
        GROUP BY 1
     )
     SELECT b.bucket_start, COALESCE(h.n, 0) AS n
       FROM buckets b LEFT JOIN hits h USING (bucket_start)
      ORDER BY b.bucket_start ASC`;

  const safe = async (sql: string): Promise<number[]> => {
    try {
      const { rows } = await ctx.pool.query(sql);
      return rows.map((r) => Number(r.n ?? 0));
    } catch {
      return new Array(24).fill(0);
    }
  };

  const [memories, journal, blocks, flags] = await Promise.all([
    safe(bucketSql("memories", "created_at")),
    safe(bucketSql("agent_journal", "written_at")),
    safe(bucketSql("ethics_audit", "created_at", `AND (final_decision = 'block' OR blocked = true)`)),
    safe(bucketSql("ethics_audit", "created_at", `AND final_decision = 'flag'`)),
  ]);

  sendJson(res, 200, {
    bucket_minutes: 60,
    bucket_count: 24,
    memories,
    journal,
    ethics_blocks: blocks,
    ethics_flags: flags,
  });
}

/** Last N events across memories + journal + ethics, sorted by ts. */
export async function activityRecent(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { limit } = paginate(req);
  const lim = Math.min(limit, 50);
  try {
    const sql = `
      WITH mem AS (
        SELECT 'memory'::text AS type, id::text AS id, created_at AS ts,
               left(content, 240) AS text, tags::text AS extra,
               importance::numeric AS score
          FROM memories
         ORDER BY created_at DESC LIMIT $1
      ),
      jrn AS (
        SELECT 'journal'::text AS type, id::text, written_at AS ts,
               left(content, 240) AS text, entry_type AS extra,
               importance::numeric AS score
          FROM agent_journal
         ORDER BY written_at DESC LIMIT $1
      ),
      eth AS (
        SELECT 'ethics'::text AS type, id::text, created_at AS ts,
               left(reason, 240) AS text,
               COALESCE(final_decision, CASE WHEN blocked THEN 'block' ELSE 'allow' END) AS extra,
               confidence::numeric AS score
          FROM ethics_audit
         ORDER BY created_at DESC LIMIT $1
      )
      SELECT * FROM mem UNION ALL SELECT * FROM jrn UNION ALL SELECT * FROM eth
       ORDER BY ts DESC LIMIT $1`;
    const { rows } = await ctx.pool.query(sql, [lim]);
    sendJson(res, 200, { events: rows });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}

/** Current PAD + circadian telemetry for the operator's user_id.
 *  Fresh-on-read — the engine applies the time-of-day rhythm patch
 *  on each call so the value tracks wall-clock. */
export async function limbicState(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.engine?.getLimbicState || !ctx.engine?.getCircadianTelemetry) {
    return sendError(res, 503, "ENGINE_NOT_READY", "engine not initialized yet");
  }
  try {
    const [state, telemetry] = await Promise.all([
      ctx.engine.getLimbicState(ctx.userId),
      ctx.engine.getCircadianTelemetry(ctx.userId),
    ]);
    const s = state as Record<string, unknown> | null;
    const t = telemetry as Record<string, unknown> | null;
    let tz: { iana: string; offset_minutes: number } | null = null;
    try {
      const { rows } = await ctx.pool.query(
        `SELECT timezone_iana, timezone_offset
           FROM user_profiles WHERE user_id = $1 LIMIT 1`,
        [ctx.userId],
      );
      if (rows[0]) {
        tz = {
          iana: String(rows[0].timezone_iana ?? "UTC"),
          offset_minutes: Math.round(Number(rows[0].timezone_offset ?? 0) * 60),
        };
      }
    } catch { /* user_profiles row may not exist yet */ }
    sendJson(res, 200, {
      mood: s
        ? {
            pleasure: Number(s.pleasure ?? 0),
            arousal: Number(s.arousal ?? 0),
            dominance: Number(s.dominance ?? 0),
          }
        : null,
      circadian: t
        ? {
            time_of_day: String(t.timeOfDay ?? ""),
            local_hour: Number(t.localHour ?? 0),
            rhythm: Number(t.rhythmComponent ?? 0),
            arousal_after_regulation: Number(t.arousalAfterRegulation ?? 0),
          }
        : null,
      timezone: tz,
    });
  } catch (err) {
    ctx.logger?.warn?.(
      `limbic-state failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    sendError(res, 500, "LIMBIC_ERROR", "limbic state unavailable");
  }
}
