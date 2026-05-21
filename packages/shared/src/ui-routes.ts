/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// UI HTTP routes for the OpenClaw plugin "Celiums Cognition".
//
// Architecture: the OpenClaw gateway exposes a per-plugin HTTP mount under
// /plugins/<plugin-id>/ via `api.registerHttpRoute()`. The plugin serves
// its own SPA (static HTML + bundle) at the root and a JSON REST API
// under /api/celiums-cognition/* that the SPA consumes.
//
// This module is the BACKEND: REST endpoints that read from pg/TEI/
// runtime state and return JSON. The SPA frontend is built separately
// (see docs/ui-brief) and bundled into dist/ui/ at build time.
//
// All handlers are plain Node IncomingMessage/ServerResponse — that is
// the contract OpenClawPluginHttpRouteHandler exposes (no Express, no
// framework). Helpers below wrap the raw types into a small ergonomic
// surface for handler authors.

import type { IncomingMessage, ServerResponse } from "node:http";
import * as net from "node:net";
import { Pool } from "pg";
import { makeAuthRouter, type AuthRouter } from "./auth-routes.js";

// ─── small helpers ─────────────────────────────────────────────────────

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { error: { code, message } });
}

function parseQuery(req: IncomingMessage): URLSearchParams {
  // OpenClaw routes the request to the plugin without rewriting URL, so we
  // can use req.url; gateway origin doesn't matter for query parsing.
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  return url.searchParams;
}

/** Probe a TCP listener with a short timeout (used by /health). */
function probeListener(
  host: string,
  port: number,
  timeoutMs = 800,
): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const t = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(t);
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

// ─── runtime context ───────────────────────────────────────────────────
// The adapter calls makeUiRouter(...) with these once; the returned
// `handlers` object exposes a function per endpoint that the adapter
// wires into registerHttpRoute. No globals — everything lives behind
// these closures.

export interface UiRouterContext {
  pool: Pool;
  /** Engine config the adapter resolved (for endpoint metadata). */
  engineConfig: {
    databaseUrl?: string;
    qdrantUrl?: string;
    valkeyUrl?: string;
  };
  /** TEI base URL — same env CELIUMS_LLM uses for embed calls (see
   *  README). When absent, /semantic search degrades to text-only. */
  teiUrl?: string;
  /** Plugin metadata for /health. */
  plugin: {
    id: string;
    version: string;
    edition: "hard" | "lite";
  };
  /** Seed metadata if a seed has been applied (filled by SeedManager
   *  on success). Optional. */
  seedState?: {
    version: string;
    appliedAt: string;
  };
  installedAt?: string;
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}

// ─── endpoint implementations ──────────────────────────────────────────

/** GET /api/celiums-cognition/health
 *  Returns stack health, plugin metadata, seed state. */
async function health(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parse = (url: string | undefined) => {
    if (!url) return undefined;
    try {
      const u = new URL(url);
      return { host: u.hostname, port: Number(u.port) || 80 };
    } catch {
      return undefined;
    }
  };
  const pgEp = parse(ctx.engineConfig.databaseUrl);
  const qdEp = parse(ctx.engineConfig.qdrantUrl);
  const vkEp = parse(ctx.engineConfig.valkeyUrl);
  const teiEp = parse(ctx.teiUrl);

  const [pgOk, qdOk, vkOk, teiOk] = await Promise.all([
    pgEp ? probeListener(pgEp.host, pgEp.port) : Promise.resolve(false),
    qdEp ? probeListener(qdEp.host, qdEp.port) : Promise.resolve(false),
    vkEp ? probeListener(vkEp.host, vkEp.port) : Promise.resolve(false),
    teiEp ? probeListener(teiEp.host, teiEp.port) : Promise.resolve(false),
  ]);

  // Best-effort DB size + tei model id
  let pgSize: number | null = null;
  if (pgOk) {
    try {
      const { rows } = await ctx.pool.query(
        `SELECT pg_database_size(current_database())::bigint AS n`,
      );
      pgSize = Number(rows[0]?.n ?? 0);
    } catch {
      pgSize = null;
    }
  }
  let teiModel: string | null = null;
  if (teiOk && ctx.teiUrl) {
    try {
      const r = await fetch(`${ctx.teiUrl.replace(/\/$/, "")}/info`, {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) {
        const info = (await r.json()) as { model_id?: string };
        teiModel = info.model_id ?? null;
      }
    } catch {
      /* leave null */
    }
  }

  sendJson(res, 200, {
    version: ctx.plugin.version,
    edition: ctx.plugin.edition,
    installed_at: ctx.installedAt ?? null,
    stack: {
      postgres: pgEp
        ? {
            ok: pgOk,
            endpoint: `${pgEp.host}:${pgEp.port}`,
            size_bytes: pgSize,
          }
        : null,
      qdrant: qdEp ? { ok: qdOk, endpoint: `${qdEp.host}:${qdEp.port}` } : null,
      valkey: vkEp ? { ok: vkOk, endpoint: `${vkEp.host}:${vkEp.port}` } : null,
      tei: teiEp
        ? {
            ok: teiOk,
            endpoint: `${teiEp.host}:${teiEp.port}`,
            model: teiModel,
          }
        : null,
    },
    seed: ctx.seedState ?? null,
  });
}

/** GET /api/celiums-cognition/counts */
async function counts(
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
      safe(
        `SELECT COUNT(*)::bigint AS n FROM memories WHERE created_at > NOW() - INTERVAL '24 hours'`,
      ),
      safe(
        `SELECT COUNT(*)::bigint AS n FROM agent_journal WHERE written_at > NOW() - INTERVAL '24 hours'`,
      ),
      safe(
        `SELECT COUNT(*)::bigint AS n FROM ethics_audit WHERE created_at > NOW() - INTERVAL '24 hours' AND blocked = true`,
      ),
      safe(
        `SELECT COUNT(*)::bigint AS n FROM ethics_audit WHERE created_at > NOW() - INTERVAL '24 hours' AND blocked = false`,
      ),
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

/** GET /api/celiums-cognition/pillars */
async function pillars(
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
    sendError(res, 500, "DB_ERROR", String(err));
  }
}

/** Embed a query string via TEI for semantic search. Returns null on
 *  failure so the handler can fall back to text-only. */
async function embedQuery(
  teiUrl: string,
  text: string,
): Promise<number[] | null> {
  try {
    const r = await fetch(`${teiUrl.replace(/\/$/, "")}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: [text.slice(0, 6000)] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const arr = (await r.json()) as number[][];
    return Array.isArray(arr?.[0]) ? arr[0] : null;
  } catch {
    return null;
  }
}

/** Format a vector array for pgvector literal (`[v1,v2,...]::vector`). */
function vecLiteral(v: number[]): string {
  return "[" + v.map((x) => x.toFixed(7)).join(",") + "]";
}

/** GET /api/celiums-cognition/skills?q=&semantic=&pillar=&category=&...&limit=&offset= */
async function skillsSearch(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const params = parseQuery(req);
  const q = (params.get("q") ?? "").trim();
  const semantic = params.get("semantic") === "true";
  const minEval = Number(params.get("min_eval") ?? "0") || 0;
  const grounded = params.get("grounded") === "true";
  const category = params.get("category");
  const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? "50") || 50));
  const offset = Math.max(0, Number(params.get("offset") ?? "0") || 0);
  const pillars = params.getAll("pillar"); // repeatable

  // ── build WHERE ──
  const where: string[] = [];
  const args: unknown[] = [];
  if (pillars.length > 0) {
    args.push(pillars);
    where.push(`pillar = ANY($${args.length}::text[])`);
  }
  if (category) {
    args.push(category);
    where.push(`category = $${args.length}`);
  }
  if (minEval > 0) {
    args.push(minEval);
    where.push(`eval_score >= $${args.length}`);
  }
  if (grounded) {
    where.push(`grounded = true`);
  }

  // ── semantic search path ──
  if (semantic && q && ctx.teiUrl) {
    const v = await embedQuery(ctx.teiUrl, q);
    if (v && v.length > 0) {
      args.push(vecLiteral(v));
      const vecIdx = args.length;
      const whereSql = where.length ? `WHERE ${where.join(" AND ")} AND embedding IS NOT NULL` : `WHERE embedding IS NOT NULL`;
      args.push(limit);
      args.push(offset);
      const limitIdx = args.length - 1;
      const offsetIdx = args.length;
      try {
        const sql = `
          SELECT name, display_name, description, pillar, category, keywords,
                 eval_score, eval_verdict, line_count, grounded,
                 1 - (embedding <=> $${vecIdx}::vector) AS similarity
            FROM skills
            ${whereSql}
            ORDER BY embedding <=> $${vecIdx}::vector
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;
        const { rows } = await ctx.pool.query(sql, args);
        // separate query for total under same filters (without semantic ranking)
        const totalSql = `SELECT COUNT(*)::bigint AS n FROM skills ${
          where.length ? `WHERE ${where.join(" AND ")} AND embedding IS NOT NULL` : `WHERE embedding IS NOT NULL`
        }`;
        const totalArgs = args.slice(0, where.length); // only filter args, exclude the vec/limit/offset
        // recompute totalArgs precisely: pillars + category + minEval (no grounded since inline)
        const filterArgs: unknown[] = [];
        if (pillars.length > 0) filterArgs.push(pillars);
        if (category) filterArgs.push(category);
        if (minEval > 0) filterArgs.push(minEval);
        const { rows: totalRows } = await ctx.pool.query(totalSql, filterArgs);
        return sendJson(res, 200, {
          total: Number(totalRows[0]?.n ?? 0),
          mode: "semantic",
          skills: rows.map((r) => ({
            name: r.name,
            display_name: r.display_name,
            description: r.description,
            pillar: r.pillar,
            category: r.category,
            keywords: r.keywords,
            eval_score: r.eval_score ? Number(r.eval_score) : null,
            eval_verdict: r.eval_verdict,
            line_count: r.line_count,
            grounded: r.grounded,
            similarity: r.similarity ? Number(r.similarity) : null,
          })),
        });
      } catch (err) {
        ctx.logger?.warn?.(`semantic search failed: ${String(err)}, falling back to FTS`);
      }
    }
  }

  // ── FTS (BM25 via search_tsv) fallback / default ──
  let orderBy = `eval_score DESC NULLS LAST, name`;
  if (q) {
    args.push(q);
    where.push(`search_tsv @@ plainto_tsquery('english', $${args.length})`);
    orderBy = `ts_rank(search_tsv, plainto_tsquery('english', $${args.length})) DESC`;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ``;
  args.push(limit);
  args.push(offset);
  const limitIdx = args.length - 1;
  const offsetIdx = args.length;
  try {
    const sql = `
      SELECT name, display_name, description, pillar, category, keywords,
             eval_score, eval_verdict, line_count, grounded
        FROM skills
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const { rows } = await ctx.pool.query(sql, args);
    const filterArgs = args.slice(0, args.length - 2);
    const totalSql = `SELECT COUNT(*)::bigint AS n FROM skills ${whereSql}`;
    const { rows: totalRows } = await ctx.pool.query(totalSql, filterArgs);
    sendJson(res, 200, {
      total: Number(totalRows[0]?.n ?? 0),
      mode: q ? "fts" : "browse",
      skills: rows.map((r) => ({
        name: r.name,
        display_name: r.display_name,
        description: r.description,
        pillar: r.pillar,
        category: r.category,
        keywords: r.keywords,
        eval_score: r.eval_score ? Number(r.eval_score) : null,
        eval_verdict: r.eval_verdict,
        line_count: r.line_count,
        grounded: r.grounded,
      })),
    });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", String(err));
  }
}

/** GET /api/celiums-cognition/skills/:name — full row including content */
async function skillDetail(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // path shape: /api/celiums-cognition/skills/<name>
  const match = (req.url || "").match(/\/skills\/([^/?]+)/);
  if (!match) {
    return sendError(res, 400, "BAD_PATH", "skill name missing");
  }
  const name = decodeURIComponent(match[1]);
  try {
    const { rows } = await ctx.pool.query(
      `SELECT name, display_name, description, content, pillar, category,
              keywords, line_count, has_references, reference_count,
              eval_score, eval_verdict, eval_date, grounded, source_count,
              created_at, updated_at, agent_type, version, subcat,
              provenance_status
         FROM skills WHERE name = $1 LIMIT 1`,
      [name],
    );
    if (rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", `skill ${name} not found`);
    }
    sendJson(res, 200, { skill: rows[0] });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", String(err));
  }
}

// ─── memory / journal / ethics handlers ────────────────────────────────

/** Read pagination params with safe caps. */
function paginate(req: IncomingMessage): { limit: number; offset: number } {
  const q = parseQuery(req);
  let limit = parseInt(q.get("limit") ?? "20", 10);
  let offset = parseInt(q.get("offset") ?? "0", 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  limit = Math.min(limit, 200);
  offset = Math.min(offset, 1_000_000);
  return { limit, offset };
}

/** GET /api/celiums-cognition/memories
 *  List recent memories, paginated. Optional ?q= filters by content ILIKE.
 *  Single-account → no user_id filter (everything belongs to the operator). */
async function memoriesList(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { limit, offset } = paginate(req);
  const q = parseQuery(req).get("q")?.trim() ?? "";
  try {
    const params: unknown[] = [];
    let where = "";
    if (q) {
      params.push(`%${q}%`);
      // idx_memories_content_trgm makes ILIKE practical at scale.
      where = `WHERE content ILIKE $${params.length}`;
    }
    params.push(limit, offset);
    const { rows } = await ctx.pool.query(
      `SELECT id, user_id, project_id, session_id, content, summary,
              memory_type, scope, importance, emotional_valence,
              emotional_arousal, emotional_dominance, confidence,
              strength, retrieval_count, last_retrieved_at, state,
              tags, created_at, updated_at
         FROM memories ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const { rows: countRows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM memories ${q ? "WHERE content ILIKE $1" : ""}`,
      q ? [`%${q}%`] : [],
    );
    sendJson(res, 200, {
      memories: rows,
      total: countRows[0]?.n ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", String(err));
  }
}

/** GET /api/celiums-cognition/journal/recent
 *  Most recent journal entries with the SHA-chained hash for verification. */
async function journalRecent(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Engine table is `agent_journal` (no per-user table because the engine
  // is single-tenant at this layer; the user_id column lives on each row
  // when the dispatcher passes it through, but single-account plugin
  // ignores it for display).
  const { limit, offset } = paginate(req);
  try {
    const { rows } = await ctx.pool.query(
      `SELECT id, agent_id, session_id, entry_type, content, importance,
              written_at, prev_hash, hash, conversation_id, valence,
              valence_reason, visibility, tags, preceded_by
         FROM agent_journal
        ORDER BY written_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const { rows: countRows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM agent_journal`,
    );
    sendJson(res, 200, {
      entries: rows,
      total: countRows[0]?.n ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", String(err));
  }
}

/** GET /api/celiums-cognition/ethics/events
 *  Audit-log entries from the ethics pipeline. ?decision=block|flag|allow|all
 *  ?law=1|2|3 (Three Laws) optional. */
async function ethicsEvents(
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
    sendError(res, 500, "DB_ERROR", String(err));
  }
}

/** GET /api/celiums-cognition/activity/sparklines
 *  Returns 24 hourly buckets (oldest → newest) for each activity stream so
 *  the Overview tab can render sparklines without per-row math on the
 *  client. */
async function activitySparklines(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // generate_series of hour buckets, left-joined with counts. Returns 24
  // rows even when a stream is empty. All four queries run in parallel.
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

/** GET /api/celiums-cognition/activity/recent
 *  Last 12 events across memories, journal, ethics — unioned + sorted by
 *  timestamp. Each row carries a `type` discriminator for the Overview
 *  feed. */
async function activityRecent(
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
    sendError(res, 500, "DB_ERROR", String(err));
  }
}

/** GET /api/celiums-cognition/version-check
 *  Stub: returns current === latest. Wire to ClawHub/GitHub release feed later. */
async function versionCheck(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  sendJson(res, 200, {
    current: ctx.plugin.version,
    latest: ctx.plugin.version,
    update_available: false,
  });
}

// ─── router ─────────────────────────────────────────────────────────────

export type UiRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;

export interface UiRoutes {
  health: UiRouteHandler;
  counts: UiRouteHandler;
  pillars: UiRouteHandler;
  skillsSearch: UiRouteHandler;
  skillDetail: UiRouteHandler;
  memoriesList: UiRouteHandler;
  journalRecent: UiRouteHandler;
  ethicsEvents: UiRouteHandler;
  activitySparklines: UiRouteHandler;
  activityRecent: UiRouteHandler;
  versionCheck: UiRouteHandler;
  /** Prefix handler that dispatches /api/celiums-cognition/* by parsing the
   *  path. Use this single handler with registerHttpRoute({match:"prefix"}). */
  apiPrefix: UiRouteHandler;
}

export function makeUiRouter(ctx: UiRouterContext): UiRoutes {
  const auth: AuthRouter = makeAuthRouter({ pool: ctx.pool, logger: ctx.logger });

  const h = {
    health: (req: IncomingMessage, res: ServerResponse) => health(ctx, req, res),
    counts: (req: IncomingMessage, res: ServerResponse) => counts(ctx, req, res),
    pillars: (req: IncomingMessage, res: ServerResponse) => pillars(ctx, req, res),
    skillsSearch: (req: IncomingMessage, res: ServerResponse) =>
      skillsSearch(ctx, req, res),
    skillDetail: (req: IncomingMessage, res: ServerResponse) =>
      skillDetail(ctx, req, res),
    memoriesList: (req: IncomingMessage, res: ServerResponse) =>
      memoriesList(ctx, req, res),
    journalRecent: (req: IncomingMessage, res: ServerResponse) =>
      journalRecent(ctx, req, res),
    ethicsEvents: (req: IncomingMessage, res: ServerResponse) =>
      ethicsEvents(ctx, req, res),
    activitySparklines: (req: IncomingMessage, res: ServerResponse) =>
      activitySparklines(ctx, req, res),
    activityRecent: (req: IncomingMessage, res: ServerResponse) =>
      activityRecent(ctx, req, res),
    versionCheck: (req: IncomingMessage, res: ServerResponse) =>
      versionCheck(ctx, req, res),
  };

  // Endpoints the SPA needs BEFORE the user is authenticated (bootstrap +
  // signup/login). Everything else gates on an active session.
  const PUBLIC_ENDPOINTS = new Set([
    "/health",
    "",
    "/",
    "/version-check",
  ]);

  async function requireActiveSession(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const sess = await auth.resolveSession(req);
    if (!sess || sess.session.scope !== "active") {
      sendError(res, 401, "AUTH_REQUIRED", "active session required");
      return false;
    }
    return true;
  }

  const dispatch: UiRouteHandler = async (req, res) => {
    const path = (req.url || "/").split("?")[0];
    // Strip plugin prefix if present — gateway routes by prefix match
    const p = path.replace(/^.*?\/api\/celiums-cognition/, "");

    // Auth subtree — the auth router handles its own method dispatch.
    if (p === "/auth" || p.startsWith("/auth/")) {
      return auth.dispatch(req, res, p.replace(/^\/auth/, "") || "/");
    }

    if (req.method !== "GET") {
      return sendError(res, 405, "METHOD_NOT_ALLOWED", `${req.method} not allowed`);
    }

    // Public bootstrap endpoints. /health is intentionally public so the
    // SPA can show the install status even before signup.
    if (PUBLIC_ENDPOINTS.has(p)) {
      if (p === "" || p === "/" || p === "/health") return h.health(req, res);
      if (p === "/version-check") return h.versionCheck(req, res);
    }

    // Everything below requires an active session.
    if (!(await requireActiveSession(req, res))) return;

    if (p === "/counts") return h.counts(req, res);
    if (p === "/pillars") return h.pillars(req, res);
    if (p === "/skills") return h.skillsSearch(req, res);
    if (p.startsWith("/skills/")) return h.skillDetail(req, res);
    if (p === "/memories") return h.memoriesList(req, res);
    if (p === "/journal/recent") return h.journalRecent(req, res);
    if (p === "/ethics/events") return h.ethicsEvents(req, res);
    if (p === "/activity/sparklines") return h.activitySparklines(req, res);
    if (p === "/activity/recent") return h.activityRecent(req, res);
    sendError(res, 404, "NOT_FOUND", `no route for ${p}`);
  };

  return { ...h, apiPrefix: dispatch };
}
