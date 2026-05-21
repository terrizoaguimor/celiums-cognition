/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Public bootstrap endpoints. /health is intentionally reachable
// before signup so the SPA can render an install status page even when
// no account exists yet. /version-check is a stub today; wire to
// ClawHub/GitHub release feed later.

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, probeListener, type UiRouterContext } from "./utils.js";

/** Stack health, plugin metadata, seed state. */
export async function health(
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
  const osEp = parse(process.env.OPENSEARCH_URL);

  const [pgOk, qdOk, vkOk, teiOk, osOk] = await Promise.all([
    pgEp ? probeListener(pgEp.host, pgEp.port) : Promise.resolve(false),
    qdEp ? probeListener(qdEp.host, qdEp.port) : Promise.resolve(false),
    vkEp ? probeListener(vkEp.host, vkEp.port) : Promise.resolve(false),
    teiEp ? probeListener(teiEp.host, teiEp.port) : Promise.resolve(false),
    osEp ? probeListener(osEp.host, osEp.port) : Promise.resolve(false),
  ]);

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
    } catch { /* leave null */ }
  }

  // OpenSearch ethics-corpus doc count — informational. Probed only
  // when the listener is up; cheap GET /_count call with a 1.5s budget.
  let ethicsCorpusCount: number | null = null;
  if (osOk && osEp) {
    try {
      const indexName = process.env.ETHICS_INDEX || "ethics_knowledge";
      const r = await fetch(
        `http://${osEp.host}:${osEp.port}/${indexName}/_count`,
        { signal: AbortSignal.timeout(1500) },
      );
      if (r.ok) {
        const info = (await r.json()) as { count?: number };
        ethicsCorpusCount = typeof info.count === "number" ? info.count : null;
      }
    } catch { /* leave null */ }
  }

  sendJson(res, 200, {
    version: ctx.plugin.version,
    edition: ctx.plugin.edition,
    installed_at: ctx.installedAt ?? null,
    stack: {
      postgres: pgEp ? { ok: pgOk, endpoint: `${pgEp.host}:${pgEp.port}`, size_bytes: pgSize } : null,
      qdrant: qdEp ? { ok: qdOk, endpoint: `${qdEp.host}:${qdEp.port}` } : null,
      valkey: vkEp ? { ok: vkOk, endpoint: `${vkEp.host}:${vkEp.port}` } : null,
      opensearch: osEp ? {
        ok: osOk,
        endpoint: `${osEp.host}:${osEp.port}`,
        ethics_corpus_docs: ethicsCorpusCount,
      } : null,
      tei: teiEp ? { ok: teiOk, endpoint: `${teiEp.host}:${teiEp.port}`, model: teiModel } : null,
    },
    seed: ctx.seedState ?? null,
  });
}

/** Stub: returns current === latest. Wire to a real release feed later. */
export async function versionCheck(
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
