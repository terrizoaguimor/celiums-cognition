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
import {
  buildMemoryPromptSupplement,
  buildAgentIdentityPreamble,
} from "./prompt-supplement/index.js";
import { CURATED_TOOL_NAMES } from "./tool-curator/index.js";

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

/** Per-request guard: reject requests with absurdly long URLs.
 *  Defense-in-depth against DoS via pathological query strings
 *  (regex backtracking inside trigram/FTS, accidental log inflation,
 *  memory pressure parsing). Tuned generously: 8 KB covers any
 *  legitimate filter combo we expose. */
const MAX_URL_BYTES = 8 * 1024;

function urlTooLarge(req: IncomingMessage): boolean {
  return (req.url ?? "").length > MAX_URL_BYTES;
}

/** Map PG / engine error strings to a stable, non-leaky surface.
 *  We were echoing `String(err)` directly, which on duplicate-key /
 *  constraint violations exposes column/index names (e.g.,
 *  "duplicate key value violates unique constraint accounts_email_key").
 *  That's an information-disclosure surface for an attacker probing the
 *  schema. Map known kinds, otherwise return a generic message. */
function sanitizeDbError(err: unknown): string {
  if (err instanceof Error) {
    const s = err.message;
    if (/duplicate key/i.test(s)) return "duplicate value";
    if (/violates foreign key/i.test(s)) return "referenced row missing";
    if (/null value in column/i.test(s)) return "required field missing";
    if (/violates check constraint/i.test(s)) return "constraint violation";
    if (/permission denied/i.test(s)) return "operation denied";
    if (/relation .* does not exist/i.test(s)) return "internal: schema mismatch";
    // For everything else: a generic message + a stable error class so
    // operators can correlate logs without exposing details on the wire.
    return "internal db error";
  }
  return "internal error";
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
  /** Engine reference for getLimbicState / getCircadianTelemetry. The
   *  adapter wires this from the lazy engine init; null means engine
   *  isn't ready yet (very early in startup) and the endpoints will
   *  degrade with 503. */
  engine?: {
    getLimbicState?: (userId: string) => Promise<unknown>;
    getCircadianTelemetry?: (userId: string) => Promise<unknown>;
  };
  /** User id used by the single-account plugin to scope memories /
   *  limbic state. Matches cfg.userId (default "default"). */
  userId: string;
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
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
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
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
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
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
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
    // Date bucket — relative ranges resolved server-side using the user's
    // local timezone (so "today" means today in Bogota, not in UTC).
    if (bucket && bucket !== "all" && bucket !== "custom") {
      // Resolve user's timezone offset (hours)
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
      // Compute "now in user's timezone" by adding the offset
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
          args.pop(); // tz unused for raw 7-day window
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
    // Explicit ISO range overrides bucket
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

/** GET /api/celiums-cognition/journal/recent
 *  Most recent journal entries with the SHA-chained hash for verification. */
async function journalRecent(
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

/** GET /api/celiums-cognition/journal/agents
 *  List every agent_id that has at least one journal entry, with row
 *  counts + last-written timestamp + a per-entry-type breakdown. The
 *  Journal tab uses this to render a left sidebar of voices the
 *  operator can switch between. */
async function journalAgents(
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

/** GET /api/celiums-cognition/journal/lineage
 *  Parent ↔ subagent edges recorded by Fase B's three hooks
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
async function journalLineage(
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
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
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
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}

/** GET /api/celiums-cognition/limbic-state
 *  Current PAD + circadian telemetry for the operator's user_id. The
 *  agent's "felt state" right now, not a historical snapshot — getState()
 *  inside the engine applies the fresh-on-read rhythm patch so the value
 *  tracks real time. */
async function limbicState(
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
    // Also surface the stored timezone for the user (the engine resolves
    // it but doesn't put it on the telemetry object directly).
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
    sendError(res, 500, "LIMBIC_ERROR", err instanceof Error ? err.message : String(err));
  }
}

/** GET /api/celiums-cognition/timezones
 *  Full IANA timezone list (≈400 entries) so the Settings tab can render
 *  a searchable picker. Cached for an hour at the edge. */
async function timezones(
  _ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Node ≥ 18 exposes the ICU-backed enumeration. Fall back to a small
  // hard-coded set if the runtime is built without ICU.
  const intlAny = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  const list = typeof intlAny.supportedValuesOf === "function"
    ? intlAny.supportedValuesOf("timeZone")
    : ["UTC", "America/Bogota", "America/New_York", "Europe/Madrid"];
  res.setHeader("Cache-Control", "public, max-age=3600");
  sendJson(res, 200, { timezones: list });
}

/** GET /api/celiums-cognition/settings/timezone
 *  Returns the current timezone for the operator's user_id (default UTC). */
async function settingsTimezoneGet(
  ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const { rows } = await ctx.pool.query(
      `SELECT timezone_iana, timezone_offset
         FROM user_profiles WHERE user_id = $1 LIMIT 1`,
      [ctx.userId],
    );
    const row = rows[0] ?? { timezone_iana: "UTC", timezone_offset: 0 };
    sendJson(res, 200, {
      iana: String(row.timezone_iana),
      offset_minutes: Math.round(Number(row.timezone_offset) * 60),
    });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}

/** PUT /api/celiums-cognition/settings/timezone  { iana: "America/Bogota" }
 *  Persists the IANA timezone for the user. Computes and stores the
 *  offset (in hours, matching the existing column convention). Engine's
 *  CircadianEngine reads from user_profiles on next telemetry pull. */
async function settingsTimezonePut(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: { iana?: unknown };
  try {
    body = await readJsonBody(req);
  } catch {
    return sendError(res, 400, "BAD_BODY", "invalid JSON body");
  }
  const iana = String(body.iana ?? "").trim();
  if (!iana) return sendError(res, 400, "INVALID_INPUT", "iana required");
  // Validate via Intl — throws on bogus IANA strings.
  let offsetHours = 0;
  try {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      timeZoneName: "shortOffset",
    });
    const parts = dtf.formatToParts(now);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // tzName like "GMT-5" or "GMT+05:30" → parse.
    const m = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (m) {
      const sign = m[1] === "-" ? -1 : 1;
      const h = parseInt(m[2] ?? "0", 10);
      const mn = parseInt(m[3] ?? "0", 10);
      offsetHours = sign * (h + mn / 60);
    }
  } catch {
    return sendError(res, 400, "INVALID_TIMEZONE", `unknown IANA timezone: ${iana}`);
  }
  try {
    await ctx.pool.query(
      `INSERT INTO user_profiles (user_id, timezone_iana, timezone_offset)
         VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET timezone_iana = EXCLUDED.timezone_iana,
             timezone_offset = EXCLUDED.timezone_offset,
             updated_at = now()`,
      [ctx.userId, iana, offsetHours],
    );
    sendJson(res, 200, { iana, offset_minutes: Math.round(offsetHours * 60) });
  } catch (err) {
    sendError(res, 500, "DB_ERROR", sanitizeDbError(err));
  }
}

// Helper for the settings POST body parse (already exists in auth-routes
// but is module-local; duplicate the lightweight one here).
async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 32 * 1024;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX) { req.destroy(); reject(new Error("body too large")); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const txt = Buffer.concat(chunks).toString("utf-8");
        resolve(txt.length === 0 ? ({} as T) : (JSON.parse(txt) as T));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** GET /api/celiums-cognition/preview-prompt?msg=…&tools=curated|all
 *
 *  Diagnostic endpoint — reuses the SAME composer the gateway hooks run
 *  on every real turn (`buildMemoryPromptSupplement` + the engine's
 *  `turnContext`) and returns what an LLM would actually see in its
 *  system prompt for the given user message. Useful to verify the
 *  supplement is registered and the dynamic channels are firing.
 *
 *  Not a security-sensitive endpoint, but gated to active session
 *  anyway — the composed text quotes user memories. */
async function previewPrompt(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    return await previewPromptImpl(ctx, req, res);
  } catch (err) {
    ctx.logger?.warn?.(`preview-prompt threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    if (!res.headersSent) {
      sendError(
        res, 500, "PREVIEW_ERROR",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

async function previewPromptImpl(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const q = parseQuery(req);
  const msg = q.get("msg")?.trim() || "qué hablamos ayer?";
  const toolsMode = q.get("tools") === "all" ? "all" : "curated";

  // Static section — what `registerMemoryPromptSupplement` registered.
  const toolSet =
    toolsMode === "all"
      ? new Set([
          "recall", "remember", "forage", "sense",
          "journal_write", "journal_recall", "journal_arc",
          "journal_introspect", "journal_supersede", "journal_verify_chain",
          "journal_dialogue",
          "ethics_trace", "ethics_audit", "ethics_lookup",
          "map_network", "absorb", "bloom", "cultivate",
          "synthesize", "decompose", "construct", "pollinate",
          "turn_context", "turn_after", "compact_checkpoint",
        ])
      : new Set<string>(CURATED_TOOL_NAMES);
  const supplementLines = buildMemoryPromptSupplement(toolSet);

  // Dynamic section — invoke the engine's turn_context composer. The
  // runtime shape it returns is `{ prependContext: string }` — a single
  // assembled block ready to inject into the system prompt. (The
  // engine's TypeScript declaration claims `{ context, channels_loaded,
  // total_chars }`, but the bundled handler emits prependContext; we
  // mirror the runtime, not the type.)
  let prependContext = "";
  let dynamicError: string | null = null;
  // Also include the per-agent identity preamble — exactly what the
  // before_prompt_build hook prepends on every real turn, so the
  // preview matches reality.
  const identity = buildAgentIdentityPreamble({
    agentId: "preview-prompt",
    sessionId: "preview-session",
    conversationId: null,
  });
  try {
    const mod = await import("@celiumsai/cognition-engine");
    const turnContext = (mod as { turnContext?: (i: unknown, c: unknown) => Promise<unknown> }).turnContext;
    if (typeof turnContext !== "function") {
      dynamicError = "engine.turnContext not exported by this build";
    } else {
      // NB: the engine's handler reads `args.userMessage` (camelCase)
      // even though the lib/proactive.ts TypeScript declares
      // `user_message`. Pass BOTH to survive either path.
      const tc = (await turnContext(
        { user_message: msg, userMessage: msg, max_chars: 3000 } as never,
        {
          userId: ctx.userId,
          // Match the real before_prompt_build hook's capability
          // resolution so the channels that depend on env keys
          // (continuity, ethics-LLM, atlas) actually fire.
          capabilities: {
            opencore: true,
            fleet: !!process.env.CELIUMS_FLEET_API_KEY,
            atlas: !!process.env.CELIUMS_ATLAS_API_KEY,
            ai: !!process.env.CELIUMS_LLM_API_KEY,
          },
          agentId: "preview-prompt",
          sessionId: `preview-${Date.now()}`,
          memoryEngine: ctx.engine,
          pool: ctx.pool,
        },
      )) as { prependContext?: string; context?: string };
      prependContext = String(tc?.prependContext ?? tc?.context ?? "");
    }
  } catch (err) {
    dynamicError = err instanceof Error ? err.message : String(err);
  }

  // What an LLM would actually see on a real turn = identity + dynamic + static
  // (the before_prompt_build hook prepends identity+turn_context; the SDK
  // appends the static supplement separately into the system prompt).
  const staticText = supplementLines.join("\n");
  const composed = [identity, prependContext, staticText]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  sendJson(res, 200, {
    user_message: msg,
    tools_mode: toolsMode,
    identity_preamble: identity,
    static_supplement: {
      lines: supplementLines,
      total_chars: staticText.length,
    },
    dynamic_turn_context: {
      prependContext,
      total_chars: prependContext.length,
      error: dynamicError,
    },
    composed: {
      text: composed,
      total_chars: composed.length,
    },
  });
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
  journalAgents: UiRouteHandler;
  journalLineage: UiRouteHandler;
  ethicsEvents: UiRouteHandler;
  activitySparklines: UiRouteHandler;
  activityRecent: UiRouteHandler;
  limbicState: UiRouteHandler;
  timezones: UiRouteHandler;
  settingsTimezone: UiRouteHandler;
  previewPrompt: UiRouteHandler;
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
    journalAgents: (req: IncomingMessage, res: ServerResponse) =>
      journalAgents(ctx, req, res),
    journalLineage: (req: IncomingMessage, res: ServerResponse) =>
      journalLineage(ctx, req, res),
    ethicsEvents: (req: IncomingMessage, res: ServerResponse) =>
      ethicsEvents(ctx, req, res),
    activitySparklines: (req: IncomingMessage, res: ServerResponse) =>
      activitySparklines(ctx, req, res),
    activityRecent: (req: IncomingMessage, res: ServerResponse) =>
      activityRecent(ctx, req, res),
    limbicState: (req: IncomingMessage, res: ServerResponse) =>
      limbicState(ctx, req, res),
    timezones: (req: IncomingMessage, res: ServerResponse) =>
      timezones(ctx, req, res),
    settingsTimezone: (req: IncomingMessage, res: ServerResponse) =>
      req.method === "PUT"
        ? settingsTimezonePut(ctx, req, res)
        : settingsTimezoneGet(ctx, req, res),
    previewPrompt: (req: IncomingMessage, res: ServerResponse) =>
      previewPrompt(ctx, req, res),
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
    // Hard cap on URL size — anything over 8KB is rejected before any
    // handler touches it. Cheap DoS defense (regex backtracking inside
    // FTS, log inflation, request-line parsing memory) and keeps the
    // attack surface for query-string injection bounded.
    if (urlTooLarge(req)) {
      return sendError(res, 414, "URI_TOO_LONG", "request URI exceeds 8 KB");
    }
    const path = (req.url || "/").split("?")[0];
    // Strip plugin prefix if present — gateway routes by prefix match
    const p = path.replace(/^.*?\/api\/celiums-cognition/, "");

    // Auth subtree — the auth router handles its own method dispatch.
    if (p === "/auth" || p.startsWith("/auth/")) {
      return auth.dispatch(req, res, p.replace(/^\/auth/, "") || "/");
    }

    // Settings PUT/GET — handled before the GET-only gate below.
    if (p === "/settings/timezone") {
      if (req.method !== "GET" && req.method !== "PUT") {
        return sendError(res, 405, "METHOD_NOT_ALLOWED", `${req.method} not allowed`);
      }
      if (!(await requireActiveSession(req, res))) return;
      return h.settingsTimezone(req, res);
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
    if (p === "/journal/agents") return h.journalAgents(req, res);
    if (p === "/journal/lineage") return h.journalLineage(req, res);
    if (p === "/ethics/events") return h.ethicsEvents(req, res);
    if (p === "/activity/sparklines") return h.activitySparklines(req, res);
    if (p === "/activity/recent") return h.activityRecent(req, res);
    if (p === "/limbic-state") return h.limbicState(req, res);
    if (p === "/timezones") return h.timezones(req, res);
    if (p === "/preview-prompt") return h.previewPrompt(req, res);
    sendError(res, 404, "NOT_FOUND", `no route for ${p}`);
  };

  return { ...h, apiPrefix: dispatch };
}
