/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// service.start fallback: if the edition declared bootstrap and the
// required listeners aren't up, run bootstrap idempotently. Only
// probes localhost endpoints — if the operator has pointed the
// engine at a remote DB (e.g. DO Managed PG) we assume they manage
// their own infra and stay out of the way. Bootstrap failures are
// logged but never crash plugin start; the engine init is still
// lazy and will surface a clearer error at first tool call.
//
// service.stop closes the readiness gate and runs the cleanup
// callbacks the context accumulated (autoJournalThrottle interval,
// any other long-lived state).

import * as net from "node:net";
import { Pool } from "pg";
import {
  makeMigrationsRunner,
} from "@celiumsai/cognition-engine";
import {
  applyIfNeeded as applySeedIfNeeded,
  seedOptionsFromEnv,
  skillsRowCount,
  type SeedManagerOptions,
} from "../../seed.js";
import {
  applyEthicsCorpusIfNeeded,
  ethicsCorpusOptionsFromEnv,
  ethicsCorpusCount,
  type EthicsCorpusOptions,
} from "../../ethics-corpus-loader.js";
import type { PluginContext, EditionOptions } from "../context.js";
import type { OpenClawPluginApi } from "../../api.js";

const LISTENER_PROBE_TIMEOUT_MS = 1_000;

function isLocalhost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function parseHostPort(url: string | undefined): { host: string; port: number } | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const port = u.port ? Number.parseInt(u.port, 10) : NaN;
    if (!u.hostname || !Number.isFinite(port)) return undefined;
    return { host: u.hostname, port };
  } catch {
    return undefined;
  }
}

function isListenerOpen(host: string, port: number, timeoutMs = LISTENER_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}

async function runMigrations(
  edition: EditionOptions,
  ec: { databaseUrl?: string },
  api: OpenClawPluginApi,
): Promise<void> {
  if (!edition.migrationsDir || !ec.databaseUrl) return;
  const pool = new Pool({ connectionString: ec.databaseUrl, max: 1 });
  try {
    const runner = makeMigrationsRunner({
      pool: pool as unknown as Parameters<typeof makeMigrationsRunner>[0]["pool"],
      migrationsDir: edition.migrationsDir,
      logger: {
        info: (m: string) => api.logger.info(`${edition.id}: migrations: ${m}`),
        warn: (m: string) => api.logger.warn?.(`${edition.id}: migrations: ${m}`),
      },
    });
    const result = await runner.up();
    api.logger.info(
      `${edition.id}: migrations applied=${result.applied.length} skipped=${result.skipped.length}`,
    );
  } catch (err) {
    api.logger.warn?.(
      `${edition.id}: migrations failed — ${err instanceof Error ? err.message : String(err)}; tools may fail until schema is in sync`,
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function runSeed(
  edition: EditionOptions,
  ec: { databaseUrl?: string },
  api: OpenClawPluginApi,
): Promise<void> {
  if (!ec.databaseUrl) return;
  const seedOpts: SeedManagerOptions | null =
    (edition.seedOptions as SeedManagerOptions | undefined) ?? seedOptionsFromEnv();
  if (!seedOpts) return;
  const pool = new Pool({ connectionString: ec.databaseUrl, max: 1 });
  try {
    const applied = await applySeedIfNeeded(
      pool as unknown as Parameters<typeof applySeedIfNeeded>[0],
      {
        ...seedOpts,
        logger: {
          info: (m: string) => api.logger.info(`${edition.id}: ${m}`),
          warn: (m: string) => api.logger.warn?.(`${edition.id}: ${m}`),
        },
      },
    );
    if (applied) {
      const n = await skillsRowCount(
        pool as unknown as Parameters<typeof skillsRowCount>[0],
      );
      if (n != null) api.logger.info(`${edition.id}: skills corpus has ${n} rows`);
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function runEthicsCorpus(
  edition: EditionOptions,
  ec: { databaseUrl?: string },
  api: OpenClawPluginApi,
): Promise<void> {
  if (!ec.databaseUrl) return;
  const opts: EthicsCorpusOptions | null =
    (edition.ethicsCorpusOptions as EthicsCorpusOptions | undefined) ??
    ethicsCorpusOptionsFromEnv();
  if (!opts) return;
  // The corpus lands in OpenSearch; we still need a PG pool for the
  // idempotency marker in celiums_migrations.
  const pool = new Pool({ connectionString: ec.databaseUrl, max: 1 });
  try {
    const applied = await applyEthicsCorpusIfNeeded(
      pool as unknown as Parameters<typeof applyEthicsCorpusIfNeeded>[0],
      {
        ...opts,
        logger: {
          info: (m: string) => api.logger.info(`${edition.id}: ${m}`),
          warn: (m: string) => api.logger.warn?.(`${edition.id}: ${m}`),
        },
      },
    );
    if (applied) {
      const n = await ethicsCorpusCount(opts.opensearchUrl, opts.indexName);
      if (n != null) {
        api.logger.info(`${edition.id}: ethics corpus index "${opts.indexName}" has ${n} docs`);
      }
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export function wireService(ctx: PluginContext): void {
  const { api, cfg, edition, setReady, runCleanup } = ctx;

  api.registerService({
    id: edition.id,
    start: async () => {
      if (!edition.bootstrap) {
        // No infra bootstrap (remote DB or operator-managed stack).
        // Migrations + seed handled out of band; gate still opens so
        // DB-writing hooks can fire on first request.
        setReady(true);
        api.logger.info(`${edition.id}: ready (engine init is lazy, readiness gate open)`);
        return;
      }
      const engineCfg = edition.resolveEngineConfig(cfg, api);
      const ec = engineCfg as { databaseUrl?: string; qdrantUrl?: string; valkeyUrl?: string };
      const candidates = [
        { name: "postgres",   endpoint: parseHostPort(ec.databaseUrl) },
        { name: "qdrant",     endpoint: parseHostPort(ec.qdrantUrl) },
        { name: "valkey",     endpoint: parseHostPort(ec.valkeyUrl) },
        // Ethics corpus target — added when the env points at a local
        // listener so the bootstrap waits for it before running the
        // loader. If OPENSEARCH_URL points off-host, we trust the
        // operator and skip the wait.
        { name: "opensearch", endpoint: parseHostPort(process.env.OPENSEARCH_URL) },
      ].flatMap((c) =>
        c.endpoint && isLocalhost(c.endpoint.host)
          ? [{ name: c.name, host: c.endpoint.host, port: c.endpoint.port }]
          : [],
      );
      if (candidates.length === 0) {
        api.logger.info(`${edition.id}: ready (engine init is lazy, no local stack to bootstrap)`);
        return;
      }
      const checks = await Promise.all(
        candidates.map(async (c) => ({ ...c, up: await isListenerOpen(c.host, c.port) })),
      );
      const down = checks.filter((c) => !c.up);
      if (down.length === 0) {
        api.logger.info(
          `${edition.id}: ready (stack up — ${checks.map((c) => `${c.name}:${c.port}`).join(", ")})`,
        );
        await runMigrations(edition, ec, api);
        await runSeed(edition, ec, api);
        await runEthicsCorpus(edition, ec, api);
        setReady(true);
        api.logger.info(`${edition.id}: readiness gate open — db-writing hooks now active`);
        return;
      }
      api.logger.info(
        `${edition.id}: bootstrap — ${down.map((d) => `${d.name}:${d.port}`).join(", ")} not responding; running setup…`,
      );
      try {
        await edition.bootstrap(engineCfg, api);
        api.logger.info(`${edition.id}: ready (bootstrap completed)`);
        // First-install ordering: bootstrap may have minted a fresh
        // credentials.env that databaseUrlFromCredentialsFile() will
        // now resolve to a real password. Re-resolve before running
        // migrations + seed so they pick up the freshly-minted creds
        // instead of the stale legacy fallback computed at register-
        // time.
        const ecPostBootstrap = edition.resolveEngineConfig(cfg, api) as
          { databaseUrl?: string; qdrantUrl?: string; valkeyUrl?: string };
        await runMigrations(edition, ecPostBootstrap, api);
        await runSeed(edition, ecPostBootstrap, api);
        await runEthicsCorpus(edition, ecPostBootstrap, api);
        setReady(true);
        api.logger.info(`${edition.id}: readiness gate open — db-writing hooks now active`);
      } catch (err) {
        api.logger.warn?.(
          `${edition.id}: bootstrap failed — ${err instanceof Error ? err.message : String(err)}; engine will surface a clearer error at first tool call`,
        );
      }
    },
    stop: () => {
      setReady(false);
      runCleanup();
      api.logger.info(`${edition.id}: stopped (readiness gate closed, cleanup ran)`);
    },
  });
}
