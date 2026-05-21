/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Journal-tab REST endpoints. Extracted from ui-routes.ts (doctrine A1).
//
//   GET /api/celiums-cognition/journal/recent   — paginated entries
//   GET /api/celiums-cognition/journal/agents   — per-agent rollup
//   GET /api/celiums-cognition/journal/lineage  — parent↔subagent edges (Fase B)

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendJson,
  sendError,
  parseQuery,
  paginate,
  sanitizeDbError,
  type UiRouterContext,
} from "./utils.js";

/** Most recent journal entries with the SHA-chained hash for verification. */
export async function journalRecent(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Per-agent scoping (Mario 2026-05-21): each agent — main, subagents,
  // external models — keeps its own SHA-chained journal. ?agent_id=X
  // narrows to that voice; omitting it returns the union for the
  // overview view. Entry-type filter remains compatible with the older
  // single-stream UI.
  const { limit, offset } = paginate(req);
  const agentId = parseQuery(req).get("agent_id")?.trim() ?? "";
  const entryType = parseQuery(req).get("entry_type")?.trim() ?? "";
  const args: unknown[] = [];
  const where: string[] = [];
  if (agentId) {
    args.push(agentId);
    where.push(`agent_id = $${args.length}`);
  }
  if (entryType && entryType !== "all") {
    args.push(entryType);
    where.push(`entry_type = $${args.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const countArgs = [...args];
    args.push(limit, offset);
    const { rows } = await ctx.pool.query(
      `SELECT id, agent_id, session_id, entry_type, content, importance,
              written_at, prev_hash, hash, conversation_id, valence,
              valence_reason, visibility, tags, preceded_by
         FROM agent_journal
         ${whereSql}
        ORDER BY written_at DESC
        LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    const { rows: countRows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM agent_journal ${whereSql}`,
      countArgs,
    );
    sendJson(res, 200, {
      entries: rows,
      total: countRows[0]?.n ?? 0,
      limit,
      offset,
      agent_id: agentId || null,
    });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}

/** List every agent_id that has at least one journal entry, with row
 *  counts + last-written timestamp + a per-entry-type breakdown. The
 *  Journal tab uses this to render a left sidebar of voices the
 *  operator can switch between. */
export async function journalAgents(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    // Two CTEs: per-agent aggregates + per-(agent,type) counts → join.
    // Avoids the window-function-inside-GROUP-BY trap the previous
    // single-statement version hit (PG 17 syntax error at OVER).
    const { rows } = await ctx.pool.query(
      `WITH per_agent AS (
         SELECT agent_id,
                count(*)::int AS total,
                max(written_at) AS last_written_at,
                min(written_at) AS first_written_at,
                avg(valence)::float AS avg_valence
           FROM agent_journal
          GROUP BY agent_id
       ),
       per_type AS (
         SELECT agent_id,
                jsonb_object_agg(entry_type, n) AS breakdown
           FROM (
             SELECT agent_id, entry_type, count(*)::int AS n
               FROM agent_journal
              GROUP BY agent_id, entry_type
           ) x
          GROUP BY agent_id
       )
       SELECT a.agent_id, a.total, a.last_written_at, a.first_written_at,
              a.avg_valence, COALESCE(t.breakdown, '{}'::jsonb) AS breakdown
         FROM per_agent a
         LEFT JOIN per_type t USING (agent_id)
        ORDER BY a.last_written_at DESC`,
    );
    sendJson(res, 200, { agents: rows });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}

/** Parent ↔ subagent edges recorded by Fase B's three hooks
 *  (subagent_spawning / subagent_spawned / subagent_ended) into
 *  `agent_lineage`. With `?agent_id=X` returns the subgraph that
 *  contains X — both ancestry (who spawned X, transitively) and
 *  descendants (what X spawned, transitively) — capped at 10 rungs
 *  in either direction so a corrupted cycle cannot run away. Without
 *  the param, returns the most-recent 500 edges across the gateway.
 *
 *  Empty edge list with `schema: "missing"` is returned when migration
 *  014 has not yet been applied (older gateways), so the UI can degrade
 *  to "no lineage data" instead of surfacing a SQL error. */
export async function journalLineage(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const focus = parseQuery(req).get("agent_id")?.trim() ?? "";
  try {
    const exists = await ctx.pool.query(
      `SELECT to_regclass('public.agent_lineage') AS r`,
    );
    if (!exists.rows[0]?.r) {
      return sendJson(res, 200, {
        edges: [],
        focus: focus || null,
        schema: "missing",
      });
    }
    let rows;
    if (focus) {
      const r = await ctx.pool.query(
        `WITH RECURSIVE
           ancestors AS (
             SELECT l.*, 0 AS rung
               FROM agent_lineage l
              WHERE l.child_agent_id = $1
             UNION
             SELECT l.*, a.rung + 1
               FROM agent_lineage l
               JOIN ancestors a ON l.child_agent_id = a.parent_agent_id
              WHERE a.rung < 10
           ),
           descendants AS (
             SELECT l.*, 0 AS rung
               FROM agent_lineage l
              WHERE l.parent_agent_id = $1
             UNION
             SELECT l.*, d.rung + 1
               FROM agent_lineage l
               JOIN descendants d ON l.parent_agent_id = d.child_agent_id
              WHERE d.rung < 10
           )
         SELECT DISTINCT id, parent_agent_id, child_agent_id, child_session_key,
                conversation_id, task_label, mode, depth, spawned_at, ended_at,
                end_outcome, end_summary
           FROM (
             SELECT * FROM ancestors
             UNION
             SELECT * FROM descendants
           ) all_edges
          ORDER BY spawned_at DESC
          LIMIT 500`,
        [focus],
      );
      rows = r.rows;
    } else {
      const r = await ctx.pool.query(
        `SELECT id, parent_agent_id, child_agent_id, child_session_key,
                conversation_id, task_label, mode, depth, spawned_at, ended_at,
                end_outcome, end_summary
           FROM agent_lineage
          ORDER BY spawned_at DESC
          LIMIT 500`,
      );
      rows = r.rows;
    }
    sendJson(res, 200, {
      edges: rows,
      focus: focus || null,
      schema: "ready",
    });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}
