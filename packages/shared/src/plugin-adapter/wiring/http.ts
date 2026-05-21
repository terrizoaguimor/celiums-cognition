/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// HTTP routes (observability UI backend) + static SPA mount.
//
// When the edition opts in, register a prefix route under
// /api/celiums-cognition/* that the SPA frontend consumes. The
// handler resolves its dependencies (pg pool, engine config, TEI
// url, plugin metadata) lazily on first request — we can't access
// them at register() time because the engine is lazy-init.

import { makeUiRouter, type UiRouterContext } from "../../ui-routes.js";
import { makeUiStaticHandler } from "../../ui-static.js";
import { deriveEthicsMode } from "../../config-schema/index.js";
import type { PluginContext } from "../context.js";

export function wireHttpRoutes(ctx: PluginContext): void {
  const { api, cfg, userId, edition, getEngine, extractEnginePool, inboxEnqueueRef } = ctx;
  if (!edition.enableUiRoutes) return;

  let uiRouterCache: ReturnType<typeof makeUiRouter> | undefined;
  const ensureRouter = async (): Promise<ReturnType<typeof makeUiRouter>> => {
    if (uiRouterCache) return uiRouterCache;
    const engine = await getEngine();
    const pool = extractEnginePool(engine);
    if (!pool) {
      throw new Error(
        "UI routes require a Postgres pool — engine running without one",
      );
    }
    const ec = edition.resolveEngineConfig(cfg, api) as {
      databaseUrl?: string;
      qdrantUrl?: string;
      valkeyUrl?: string;
    };
    const routerCtx: UiRouterContext = {
      pool: pool as unknown as UiRouterContext["pool"],
      engine: engine as unknown as UiRouterContext["engine"],
      userId,
      engineConfig: ec,
      teiUrl: process.env.TEI_URL ?? "http://127.0.0.1:8080",
      plugin: {
        id: edition.id,
        version: edition.pluginVersion ?? "0.0.0",
        edition: "hard",
      },
      installedAt: process.env.CELIUMS_PLUGIN_INSTALLED_AT,
      agentId: cfg.agentId,
      ethicsMode: deriveEthicsMode(cfg),
      inboxEnqueue: inboxEnqueueRef.current,
      logger: {
        info: (m: string) => api.logger.info(`${edition.id}: ui: ${m}`),
        warn: (m: string) => api.logger.warn?.(`${edition.id}: ui: ${m}`),
      },
    };
    uiRouterCache = makeUiRouter(routerCtx);
    return uiRouterCache;
  };

  api.registerHttpRoute({
    path: "/api/celiums-cognition",
    match: "prefix",
    auth: "plugin",
    handler: async (req, res) => {
      try {
        const router = await ensureRouter();
        await router.apiPrefix(req, res);
      } catch (err) {
        if (!res.headersSent) {
          api.logger.warn?.(
            `${edition.id}: ui router init failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
          );
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: { code: "UI_ROUTER_UNAVAILABLE", message: "ui router unavailable" },
          }));
        }
      }
    },
  });
  api.logger.info(`${edition.id}: HTTP routes mounted at /api/celiums-cognition/*`);

  // Static SPA handler — serves index.html, the Vite-built assets,
  // and the SVG logos under /plugins/celiums-cognition/*.
  if (edition.uiStaticDir) {
    const staticHandler = makeUiStaticHandler({
      rootDir: edition.uiStaticDir,
      pathPrefix: "/plugins/celiums-cognition",
      logger: { warn: (m: string) => api.logger.warn?.(`${edition.id}: ${m}`) },
    });
    api.registerHttpRoute({
      path: "/plugins/celiums-cognition",
      match: "prefix",
      auth: "plugin",
      handler: staticHandler,
    });
    api.logger.info(
      `${edition.id}: SPA mounted at /plugins/celiums-cognition/ (serving from ${edition.uiStaticDir})`,
    );
  }
}
