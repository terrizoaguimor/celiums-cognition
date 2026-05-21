/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// UI HTTP routes for the OpenClaw plugin "Celiums Cognition".
//
// Architecture: the OpenClaw gateway exposes a per-plugin HTTP mount
// under /plugins/<plugin-id>/ via `api.registerHttpRoute()`. The plugin
// serves its own SPA (static HTML + bundle) at the root and a JSON REST
// API under /api/celiums-cognition/* that the SPA consumes.
//
// This file is the DISPATCHER only — every endpoint implementation lives
// in routes/*.ts so each domain stays within the 300-800 LOC band
// prescribed by doctrine A1. makeUiRouter wires the per-request context
// into each handler and returns a single prefix handler the adapter
// mounts against the gateway.
//
// Auth subtree (auth-routes.ts) is composed in here too — it owns its
// own method dispatch and session resolution and is the only piece that
// runs before the global GET-only gate.

import type { IncomingMessage, ServerResponse } from "node:http";
import { makeAuthRouter, type AuthRouter } from "./auth-routes.js";
import {
  sendError, urlTooLarge,
  type UiRouterContext, type UiRouteHandler,
} from "./routes/utils.js";
import { health, versionCheck } from "./routes/health.js";
import { counts, pillars } from "./routes/counts.js";
import { skillsSearch, skillDetail } from "./routes/skills.js";
import { memoriesList } from "./routes/memories.js";
import { ethicsEvents } from "./routes/ethics.js";
import { activitySparklines, activityRecent, limbicState } from "./routes/activity.js";
import { settingsTimezoneGet, settingsTimezonePut, timezones } from "./routes/settings.js";
import { previewPrompt } from "./routes/preview.js";
import {
  journalRecent, journalAgents, journalLineage,
} from "./routes/journal.js";
import {
  inboxInject, operatorStatus,
} from "./routes/operator.js";

// Re-export the context + handler types so plugin-adapter's import of
// `./ui-routes.js` still resolves them without touching the call site.
export type { UiRouterContext, UiRouteHandler };

// ─── router ─────────────────────────────────────────────────────────────

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
  operatorStatus: UiRouteHandler;
  inboxInject: UiRouteHandler;
  ethicsEvents: UiRouteHandler;
  activitySparklines: UiRouteHandler;
  activityRecent: UiRouteHandler;
  limbicState: UiRouteHandler;
  timezones: UiRouteHandler;
  settingsTimezone: UiRouteHandler;
  previewPrompt: UiRouteHandler;
  versionCheck: UiRouteHandler;
  /** Prefix handler that dispatches /api/celiums-cognition/* by parsing
   *  the path. Use this single handler with registerHttpRoute. */
  apiPrefix: UiRouteHandler;
}

export function makeUiRouter(ctx: UiRouterContext): UiRoutes {
  const auth: AuthRouter = makeAuthRouter({ pool: ctx.pool, logger: ctx.logger });

  const h: Omit<UiRoutes, "apiPrefix"> = {
    health:               (req, res) => health(ctx, req, res),
    counts:               (req, res) => counts(ctx, req, res),
    pillars:              (req, res) => pillars(ctx, req, res),
    skillsSearch:         (req, res) => skillsSearch(ctx, req, res),
    skillDetail:          (req, res) => skillDetail(ctx, req, res),
    memoriesList:         (req, res) => memoriesList(ctx, req, res),
    journalRecent:        (req, res) => journalRecent(ctx, req, res),
    journalAgents:        (req, res) => journalAgents(ctx, req, res),
    journalLineage:       (req, res) => journalLineage(ctx, req, res),
    operatorStatus:       (req, res) => operatorStatus(ctx, req, res),
    inboxInject:          (req, res) => inboxInject(ctx, req, res),
    ethicsEvents:         (req, res) => ethicsEvents(ctx, req, res),
    activitySparklines:   (req, res) => activitySparklines(ctx, req, res),
    activityRecent:       (req, res) => activityRecent(ctx, req, res),
    limbicState:          (req, res) => limbicState(ctx, req, res),
    timezones:            (req, res) => timezones(ctx, req, res),
    settingsTimezone:     (req, res) =>
      req.method === "PUT"
        ? settingsTimezonePut(ctx, req, res)
        : settingsTimezoneGet(ctx, req, res),
    previewPrompt:        (req, res) => previewPrompt(ctx, req, res),
    versionCheck:         (req, res) => versionCheck(ctx, req, res),
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

    // Inbox bridge — POST only, gated by active session. Fase F (G4
    // mailbox bridge). Handled before the GET-only gate.
    if (p === "/inbox/inject") {
      if (req.method !== "POST") {
        return sendError(res, 405, "METHOD_NOT_ALLOWED", `${req.method} not allowed`);
      }
      if (!(await requireActiveSession(req, res))) return;
      return h.inboxInject(req, res);
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
    if (p === "/operator-status") return h.operatorStatus(req, res);
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
