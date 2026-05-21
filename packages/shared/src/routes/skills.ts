/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Skills search (semantic + FTS) and per-skill detail. The semantic
// path delegates embedding to TEI; on any failure (network, dim
// mismatch, model swap mid-flight) we fall through to the FTS index
// built on `search_tsv` — operator-visible diagnostic via the `mode`
// field in the response.

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendJson, sendError, parseQuery, sanitizeDbError,
  type UiRouterContext,
} from "./utils.js";

/** Embed a query string via TEI. Returns null on failure so the
 *  handler can fall back to text-only. */
async function embedQuery(teiUrl: string, text: string): Promise<number[] | null> {
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

/** ?q=&semantic=&pillar=&category=&min_eval=&grounded=&limit=&offset= */
export async function skillsSearch(
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
  const pillars = params.getAll("pillar");

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

  // ── semantic path ──
  if (semantic && q && ctx.teiUrl) {
    const v = await embedQuery(ctx.teiUrl, q);
    if (v && v.length > 0) {
      args.push(vecLiteral(v));
      const vecIdx = args.length;
      const whereSql = where.length
        ? `WHERE ${where.join(" AND ")} AND embedding IS NOT NULL`
        : `WHERE embedding IS NOT NULL`;
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
        const totalSql = `SELECT COUNT(*)::bigint AS n FROM skills ${whereSql}`;
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

  // ── FTS fallback / default ──
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

/** /skills/:name — full row including content */
export async function skillDetail(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
