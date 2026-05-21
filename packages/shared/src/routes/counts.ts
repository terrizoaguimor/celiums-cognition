/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Aggregate counts + per-pillar breakdown for the Overview tab.
// Both endpoints swallow per-table errors so a missing table (e.g.
// ethics_audit on a fresh install) returns 0 instead of failing the
// whole request.

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, sendError, sanitizeDbError, type UiRouterContext } from "./utils.js";

export async function counts(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const safe = async (sql: string): Promise<number> => {
    try {
      const { rows } = await ctx.pool.query(sql);
      const v = rows[0]?.n;
      return typeof v === "string" ? Number(v) : (v as number | undefined) ?? 0;
    } catch {
      return 0;
    }
  };
  const [skills, memories, journal, ethics, mem24, jr24, blk24, flg24] =
    await Promise.all([
      safe(`SELECT COUNT(*)::bigint AS n FROM skills`),
      safe(`SELECT COUNT(*)::bigint AS n FROM memories`),
      safe(`SELECT COUNT(*)::bigint AS n FROM agent_journal`),
      safe(`SELECT COUNT(*)::bigint AS n FROM ethics_audit`),
      safe(`SELECT COUNT(*)::bigint AS n FROM memories WHERE created_at > NOW() - INTERVAL '24 hours'`),
      safe(`SELECT COUNT(*)::bigint AS n FROM agent_journal WHERE written_at > NOW() - INTERVAL '24 hours'`),
      safe(`SELECT COUNT(*)::bigint AS n FROM ethics_audit WHERE created_at > NOW() - INTERVAL '24 hours' AND blocked = true`),
      safe(`SELECT COUNT(*)::bigint AS n FROM ethics_audit WHERE created_at > NOW() - INTERVAL '24 hours' AND blocked = false`),
    ]);
  sendJson(res, 200, {
    skills,
    memories,
    journal_entries: journal,
    ethics_events: ethics,
    activity_24h: {
      memories_captured: mem24,
      journal_entries: jr24,
      ethics_blocks: blk24,
      ethics_flags: flg24,
    },
  });
}

export async function pillars(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const { rows } = await ctx.pool.query(
      `SELECT pillar, COUNT(*)::int AS count
         FROM skills
        WHERE pillar IS NOT NULL
        GROUP BY pillar
        ORDER BY count DESC`,
    );
    sendJson(res, 200, {
      pillars: rows.map((r) => ({
        name: r.pillar as string,
        count: r.count as number,
      })),
    });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}
