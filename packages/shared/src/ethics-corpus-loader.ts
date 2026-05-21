/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// EthicsCorpusLoader — downloads the curated ethical-concepts corpus at
// first run and bulk-indexes it to the local OpenSearch instance. Layer
// D of the ethics pipeline (corpus-grounded) consults this index;
// without it, Layer D abstains and the other four layers (lexicon,
// CVaR, multi-framework LLM, audit) still gate every tool call.
//
// Architecture mirrors the SeedManager (shared/src/seed.ts):
//   1. service.start brings up the docker stack (postgres + qdrant +
//      valkey + opensearch) and applies migrations.
//   2. SeedManager loads the skills corpus into Postgres.
//   3. EthicsCorpusLoader.applyIfNeeded() runs next:
//        - if celiums_migrations already tracks this corpus version,
//          no-op (idempotent).
//        - else: download the jsonl from CELIUMS_ETHICS_CORPUS_URL
//                (default: GitHub release asset).
//                verify SHA-256 against CELIUMS_ETHICS_CORPUS_SHA256.
//                PUT the index (idempotent: if exists, skip create).
//                bulk-index 100 docs at a time.
//                INSERT a celiums_migrations row marking the version.
//   4. Any error → best-effort log + return without crashing the
//      plugin. Layer D abstains cleanly until the next start.
//
// The corpus tarball is published as a GitHub release asset by the
// celiums-memory project and is NOT bundled inside this npm package
// (~32 MB compressed; ships at first install via the public URL).
//
// Env vars consumed (all default to the v2.0.0 release asset):
//   CELIUMS_ETHICS_CORPUS_URL     download URL of ethics_knowledge.jsonl
//   CELIUMS_ETHICS_CORPUS_SHA256  expected sha256 of the payload
//   CELIUMS_ETHICS_CORPUS_VERSION version label written to celiums_migrations
//   CELIUMS_ETHICS_CORPUS_SKIP    "true" to skip
//   OPENSEARCH_URL                target OpenSearch (defaults to local)
//   ETHICS_INDEX                  index name (default "ethics_knowledge")

import { createHash } from "node:crypto";

/** Pool surface — matches the engine's MigrationPool. Only used for the
 *  idempotency marker in celiums_migrations; the corpus itself goes to
 *  OpenSearch, not Postgres. */
export interface CorpusTrackerPool {
  query(sql: string, params?: unknown[]): Promise<{
    rows: Record<string, unknown>[];
    rowCount?: number | null;
  }>;
}

export interface EthicsCorpusOptions {
  /** Full URL of the ethics_knowledge.jsonl asset. */
  corpusUrl: string;
  /** Expected sha256 (hex). The loader refuses to apply a payload with
   *  a different hash to prevent supply-chain tampering. */
  expectedSha256: string;
  /** Version label written into celiums_migrations for tracking. */
  version: string;
  /** Target OpenSearch URL (may embed user:pass). */
  opensearchUrl: string;
  /** Target index name. */
  indexName: string;
  /** Optional logger. */
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
}

// Exact index mapping from the upstream load script
// (celiums-memory/scripts/load-ethics-knowledge.mjs:69). Do not
// "improve" — the production OpenSearch index is measured from this
// shape and any divergence breaks hybrid search ranking.
const INDEX_BODY = {
  settings: {
    index: { knn: true, "knn.algo_param": { ef_search: 100 } },
  },
  mappings: {
    properties: {
      embedding: {
        type: "knn_vector",
        dimension: 1024,
        method: {
          engine: "lucene",
          space_type: "cosinesimil",
          name: "hnsw",
          parameters: { ef_construction: 128, m: 16 },
        },
      },
      concept: { type: "text" },
      aliases: { type: "text" },
      aliases_by_lang: { type: "object" },
      explanation_en: { type: "text" },
      benign_counterparts: { type: "text" },
      distinction_rules: { type: "text" },
      legitimate_exceptions: { type: "text" },
      jurisdictional_notes: { type: "text" },
      legal_references: { type: "text" },
      category: { type: "keyword" },
      severity: { type: "keyword" },
      verdict: { type: "keyword" },
      topic_id: { type: "keyword" },
      module_hash: { type: "keyword" },
      curator_score: { type: "float" },
      verifier_score: { type: "float" },
      ingested_at: { type: "date" },
    },
  },
} as const;

/** Tracking key for celiums_migrations. */
function trackingKey(version: string): string {
  return `ethics-corpus-${version}`;
}

/** Read CELIUMS_ETHICS_CORPUS_* from env into options (or null to skip). */
export function ethicsCorpusOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EthicsCorpusOptions | null {
  if (env.CELIUMS_ETHICS_CORPUS_SKIP === "true") return null;
  const opensearchUrl = env.OPENSEARCH_URL;
  if (!opensearchUrl) return null;
  return {
    corpusUrl:
      env.CELIUMS_ETHICS_CORPUS_URL ||
      "https://github.com/terrizoaguimor/celiums-memory/releases/download/v2.0.0/ethics_knowledge.jsonl",
    expectedSha256:
      env.CELIUMS_ETHICS_CORPUS_SHA256 ||
      "2cbc7ed608a0af4d861b8e10c14e83a27b7726057215d3d6708efaa102ea82e3",
    version: env.CELIUMS_ETHICS_CORPUS_VERSION || "v2.0.0",
    opensearchUrl,
    indexName: env.ETHICS_INDEX || "ethics_knowledge",
  };
}

/** Parse `OPENSEARCH_URL` into { baseUrl, authHeader } — Node's fetch
 *  rejects credentials embedded in the URL, so we strip them and
 *  forward via Basic auth header. */
function parseOpenSearch(url: string): { baseUrl: string; authHeader?: string } {
  const u = new URL(url);
  let authHeader: string | undefined;
  if (u.username || u.password) {
    const token = Buffer.from(
      `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`,
    ).toString("base64");
    authHeader = `Basic ${token}`;
    u.username = "";
    u.password = "";
  }
  return { baseUrl: u.toString().replace(/\/$/, ""), authHeader };
}

interface CorpusDoc {
  module_hash: string;
  embedding: number[];
  [key: string]: unknown;
}

/**
 * Apply the ethics corpus at most once. Idempotent: re-running after
 * success is a no-op (detected via celiums_migrations).
 *
 * @returns true if the corpus was indexed this call, false if skipped
 *          or already applied. Errors are caught and logged; this
 *          never throws.
 */
export async function applyEthicsCorpusIfNeeded(
  tracker: CorpusTrackerPool,
  opts: EthicsCorpusOptions,
): Promise<boolean> {
  const log = opts.logger ?? {
    info: (m: string) => console.log(m),
    warn: (m: string) => console.warn(m),
  };
  const fetchFn = opts.fetchImpl ?? fetch;
  const key = trackingKey(opts.version);

  // Idempotency check against celiums_migrations.
  try {
    const applied = await tracker.query(
      `SELECT version FROM celiums_migrations WHERE version = $1 LIMIT 1`,
      [key],
    );
    if (applied.rows.length > 0) {
      log.info?.(`ethics corpus ${opts.version}: already applied (skip)`);
      return false;
    }
  } catch (err) {
    log.warn?.(
      `ethics corpus ${opts.version}: could not check celiums_migrations — ${
        err instanceof Error ? err.message : String(err)
      }. Skipping.`,
    );
    return false;
  }

  // Validate sha256 shape before doing any network work.
  if (!/^[0-9a-f]{64}$/.test(opts.expectedSha256)) {
    log.warn?.(
      `ethics corpus ${opts.version}: expectedSha256 is not a 64-char hex string. Skipping.`,
    );
    return false;
  }

  // Download the jsonl.
  let buf: Buffer;
  try {
    log.info?.(`ethics corpus ${opts.version}: downloading ${opts.corpusUrl}`);
    const res = await fetchFn(opts.corpusUrl, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    log.warn?.(
      `ethics corpus ${opts.version}: download failed — ${
        err instanceof Error ? err.message : String(err)
      }. Skipping; Layer D will abstain until next start.`,
    );
    return false;
  }

  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== opts.expectedSha256.toLowerCase()) {
    log.warn?.(
      `ethics corpus ${opts.version}: sha256 mismatch — expected ${opts.expectedSha256}, got ${got}. Refusing to load tampered corpus.`,
    );
    return false;
  }
  log.info?.(`ethics corpus ${opts.version}: sha256 OK (${(buf.length / 1048576).toFixed(1)} MB)`);

  // Parse jsonl → docs.
  const docs: CorpusDoc[] = [];
  try {
    for (const line of buf.toString("utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const d = JSON.parse(t) as CorpusDoc;
      if (!Array.isArray(d.embedding) || d.embedding.length !== 1024) {
        throw new Error(
          `doc missing/!=1024-dim embedding (module_hash=${d.module_hash ?? "?"})`,
        );
      }
      if (!d.module_hash) throw new Error("doc missing module_hash (needed as _id)");
      docs.push(d);
    }
  } catch (err) {
    log.warn?.(
      `ethics corpus ${opts.version}: parse failed — ${
        err instanceof Error ? err.message : String(err)
      }. Skipping.`,
    );
    return false;
  }
  log.info?.(`ethics corpus ${opts.version}: parsed ${docs.length} docs`);

  // OpenSearch index lifecycle (idempotent).
  let os: { baseUrl: string; authHeader?: string };
  try {
    os = parseOpenSearch(opts.opensearchUrl);
  } catch (err) {
    log.warn?.(
      `ethics corpus ${opts.version}: OPENSEARCH_URL invalid — ${
        err instanceof Error ? err.message : String(err)
      }. Skipping.`,
    );
    return false;
  }
  const osHeaders = (extra: Record<string, string> = {}): Record<string, string> =>
    os.authHeader ? { Authorization: os.authHeader, ...extra } : extra;

  try {
    const head = await fetchFn(`${os.baseUrl}/${opts.indexName}`, {
      method: "HEAD",
      headers: osHeaders(),
    });
    if (head.status !== 200) {
      const cr = await fetchFn(`${os.baseUrl}/${opts.indexName}`, {
        method: "PUT",
        headers: osHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(INDEX_BODY),
      });
      if (!cr.ok) {
        const detail = (await cr.text()).slice(0, 300);
        throw new Error(`create index ${cr.status}: ${detail}`);
      }
      log.info?.(`ethics corpus ${opts.version}: created index "${opts.indexName}"`);
    }
  } catch (err) {
    log.warn?.(
      `ethics corpus ${opts.version}: index lifecycle failed — ${
        err instanceof Error ? err.message : String(err)
      }. Skipping.`,
    );
    return false;
  }

  // Bulk index in chunks of 100.
  const CHUNK = 100;
  let indexed = 0;
  let bulkErrors = 0;
  try {
    for (let i = 0; i < docs.length; i += CHUNK) {
      const slice = docs.slice(i, i + CHUNK);
      const lines: string[] = [];
      for (const d of slice) {
        lines.push(JSON.stringify({ index: { _index: opts.indexName, _id: d.module_hash } }));
        lines.push(JSON.stringify(d));
      }
      const br = await fetchFn(`${os.baseUrl}/_bulk`, {
        method: "POST",
        headers: osHeaders({ "Content-Type": "application/x-ndjson" }),
        body: lines.join("\n") + "\n",
      });
      if (!br.ok) {
        const detail = (await br.text()).slice(0, 300);
        throw new Error(`_bulk ${br.status}: ${detail}`);
      }
      const j = (await br.json()) as {
        errors?: boolean;
        items?: Array<{ index?: { error?: unknown } }>;
      };
      const errs = j.errors ? (j.items ?? []).filter((it) => it.index?.error) : [];
      bulkErrors += errs.length;
      indexed += slice.length - errs.length;
    }
    // Refresh so the next ethics query sees the new docs.
    await fetchFn(`${os.baseUrl}/${opts.indexName}/_refresh`, {
      method: "POST",
      headers: osHeaders(),
    }).catch(() => undefined);
  } catch (err) {
    log.warn?.(
      `ethics corpus ${opts.version}: bulk index failed at ${indexed}/${docs.length} — ${
        err instanceof Error ? err.message : String(err)
      }. Partial corpus left in place; next start will retry.`,
    );
    return false;
  }

  // Record success in celiums_migrations so future starts skip.
  try {
    await tracker.query(
      `INSERT INTO celiums_migrations (version, applied_at, sha256)
       VALUES ($1, NOW(), $2)`,
      [key, opts.expectedSha256.toLowerCase()],
    );
  } catch (err) {
    log.warn?.(
      `ethics corpus ${opts.version}: indexed ${indexed} docs but tracker write failed — ${
        err instanceof Error ? err.message : String(err)
      }. Next start may re-index harmlessly (bulk upserts by module_hash).`,
    );
  }

  log.info?.(
    `ethics corpus ${opts.version}: indexed ${indexed}/${docs.length} docs into "${opts.indexName}"${
      bulkErrors ? ` (${bulkErrors} doc-level errors)` : ""
    }`,
  );
  return true;
}

/** Read-side helper: count of docs in the OpenSearch index. */
export async function ethicsCorpusCount(
  opensearchUrl: string,
  indexName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const os = parseOpenSearch(opensearchUrl);
    const headers: Record<string, string> = os.authHeader
      ? { Authorization: os.authHeader }
      : {};
    const r = await fetchImpl(`${os.baseUrl}/${indexName}/_count`, { headers });
    if (!r.ok) return null;
    const j = (await r.json()) as { count?: number };
    return typeof j.count === "number" ? j.count : null;
  } catch {
    return null;
  }
}
