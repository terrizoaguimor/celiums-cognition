/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// SeedManager — downloads a curated skills corpus snapshot at first run
// and applies it to the local Postgres so `forage` has something to find
// out of the box. Plumbing only: this file never carries any module data
// itself; the operator (or Celiums) provides the seed via the URL.
//
// Architecture:
//   1. service.start brings up docker stack + applies migrations (creates
//      the empty `skills` table from migration 009 / earlier).
//   2. SeedManager.applyIfNeeded() is invoked next:
//        - if celiums_migrations already records this seed-version, no-op
//        - else: download <baseUrl>/manifest-<version>.json
//                download <baseUrl>/seed-skills-<version>.sql.gz
//                verify sha256 against manifest.sha256
//                gunzip + apply inside a single BEGIN/COMMIT transaction
//                INSERT a row into celiums_migrations marking the version
//   3. Any error → ROLLBACK + best-effort log + return without crashing
//      the plugin (forage will still answer "no results" until next try).
//
// Distribution model:
//   - The free tier ships ~10-30K curated modules. Celiums maintains the
//     full ~600K corpus behind a paid SaaS; operators who upgrade switch
//     by setting KNOWLEDGE_API_URL + KNOWLEDGE_API_KEY +
//     CELIUMS_KNOWLEDGE_ALLOW_HOSTED=true (see lib/module-store.ts).
//
// Env vars consumed:
//   CELIUMS_SEED_URL       base URL hosting manifest + tarball
//   CELIUMS_SEED_VERSION   which seed to apply (e.g. "v1"). Default: "v1".
//   CELIUMS_SEED_SKIP      "true" to skip seeding entirely.
//
// All three default-out cleanly: with no CELIUMS_SEED_URL set, the
// SeedManager is a no-op. The plugin still works, `forage` just returns
// empty results until a seed is loaded or the operator federates to a
// hosted backend.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/** Pool surface — matches the engine's MigrationPool. */
export interface SeedPool {
  query(sql: string, params?: unknown[]): Promise<{
    rows: Record<string, unknown>[];
    rowCount?: number | null;
  }>;
}

export interface SeedManifest {
  /** Seed version label (e.g. "v1"). Mirrored in celiums_migrations. */
  version: string;
  /** sha256 hex of the .sql.gz payload. */
  sha256: string;
  /** Approximate row count, used for logging only. */
  module_count?: number;
  /** Approximate compressed size in MB, used for logging only. */
  total_size_mb?: number;
  /** License declared by the seed maintainer (e.g. "Apache-2.0"). */
  license?: string;
  /** Migration index this seed expects to exist (e.g. "009_ethics_knowledge"). */
  schema_version?: string;
  /** Category counts (display only). */
  categories?: Record<string, number>;
}

export interface SeedManagerOptions {
  /** Base URL hosting manifest-<version>.json + seed-skills-<version>.sql.gz */
  baseUrl: string;
  /** Version label to apply (e.g. "v1"). */
  version: string;
  /** Optional logger. Defaults to console. */
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch;
}

/** Tracking key for celiums_migrations. */
function trackingKey(version: string): string {
  return `seed-skills-${version}`;
}

/** Read CELIUMS_SEED_* from env into options (or null to skip). */
export function seedOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SeedManagerOptions | null {
  if (env.CELIUMS_SEED_SKIP === "true") return null;
  const baseUrl = env.CELIUMS_SEED_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    version: env.CELIUMS_SEED_VERSION || "v1",
  };
}

/**
 * Apply the seed at most once. Idempotent: re-running after success is a
 * no-op (detected via celiums_migrations).
 *
 * @returns true if a seed was applied this call, false if skipped or already
 *          applied. Errors are caught and logged; this never throws.
 */
export async function applyIfNeeded(
  pool: SeedPool,
  opts: SeedManagerOptions,
): Promise<boolean> {
  const log = opts.logger ?? {
    info: (m: string) => console.log(m),
    warn: (m: string) => console.warn(m),
  };
  const fetchFn = opts.fetchImpl ?? fetch;
  const key = trackingKey(opts.version);

  try {
    // celiums_migrations is created by the engine's migration runner; if
    // it's missing here, the migration step hasn't run yet — caller bug.
    const applied = await pool.query(
      `SELECT version FROM celiums_migrations WHERE version = $1 LIMIT 1`,
      [key],
    );
    if (applied.rows.length > 0) {
      log.info?.(`seed ${opts.version}: already applied (skip)`);
      return false;
    }
  } catch (err) {
    log.warn?.(
      `seed ${opts.version}: could not check celiums_migrations — ${
        err instanceof Error ? err.message : String(err)
      }. Skipping seed (apply migrations first).`,
    );
    return false;
  }

  // Manifest first — small JSON describing what we're about to download.
  let manifest: SeedManifest;
  try {
    const manifestUrl = `${opts.baseUrl}/manifest-${opts.version}.json`;
    log.info?.(`seed ${opts.version}: fetching manifest from ${manifestUrl}`);
    const res = await fetchFn(manifestUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} for manifest`);
    manifest = (await res.json()) as SeedManifest;
  } catch (err) {
    log.warn?.(
      `seed ${opts.version}: manifest unavailable — ${
        err instanceof Error ? err.message : String(err)
      }. Skipping.`,
    );
    return false;
  }

  if (manifest.version !== opts.version) {
    log.warn?.(
      `seed ${opts.version}: manifest version mismatch (${manifest.version}). Skipping.`,
    );
    return false;
  }
  if (!manifest.sha256 || !/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    log.warn?.(`seed ${opts.version}: manifest has no valid sha256. Skipping.`);
    return false;
  }

  // Download the tarball to a tmp file and verify its sha256.
  const tmp = await mkdtemp(join(tmpdir(), "celiums-seed-"));
  const tarPath = join(tmp, `seed-skills-${opts.version}.sql.gz`);
  try {
    const dlUrl = `${opts.baseUrl}/seed-skills-${opts.version}.sql.gz`;
    log.info?.(
      `seed ${opts.version}: downloading ${dlUrl}${
        manifest.total_size_mb ? ` (~${manifest.total_size_mb} MB)` : ""
      }`,
    );
    const res = await fetchFn(dlUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} for tarball`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(buf).digest("hex");
    if (got !== manifest.sha256.toLowerCase()) {
      throw new Error(
        `sha256 mismatch — expected ${manifest.sha256}, got ${got}. Refusing to apply tampered seed.`,
      );
    }
    // Write to tmp for debuggability; not strictly needed.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(tarPath, buf);

    // Decompress and apply inside a single transaction. If the file is
    // multi-statement INSERT-only SQL, pg.query happily accepts it.
    const sql = gunzipSync(buf).toString("utf8");
    log.info?.(
      `seed ${opts.version}: applying${
        manifest.module_count ? ` (~${manifest.module_count} rows)` : ""
      }…`,
    );
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(
        `INSERT INTO celiums_migrations (version, applied_at, sha256)
         VALUES ($1, NOW(), $2)`,
        [key, manifest.sha256.toLowerCase()],
      );
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK").catch(() => undefined);
      throw err;
    }

    log.info?.(
      `seed ${opts.version}: applied${
        manifest.module_count
          ? ` (${manifest.module_count} rows across ${
              Object.keys(manifest.categories ?? {}).length
            } categories)`
          : ""
      }${manifest.license ? ` [${manifest.license}]` : ""}`,
    );
    return true;
  } catch (err) {
    log.warn?.(
      `seed ${opts.version}: apply failed — ${
        err instanceof Error ? err.message : String(err)
      }. Plugin still works; forage will return empty until retry.`,
    );
    return false;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Read-side helper: how many rows in `skills` (for status logging). */
export async function skillsRowCount(pool: SeedPool): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::bigint AS n FROM skills`,
    );
    const n = rows[0]?.n;
    return typeof n === "string" ? Number(n) : (n as number | undefined) ?? null;
  } catch {
    return null;
  }
}
