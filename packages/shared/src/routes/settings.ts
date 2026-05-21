/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Operator settings — timezone get/put + supported-zones picker.
//
// The PUT path validates the IANA name with Intl.DateTimeFormat
// (throws on bogus strings) and persists hours-offset into the same
// `user_profiles.timezone_offset` column the limbic engine reads on
// every circadian call. No engine notification needed — the next
// `getCircadianTelemetry` re-loads the row.

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendJson, sendError, readJsonBody, sanitizeDbError,
  type UiRouterContext,
} from "./utils.js";

/** Returns the current timezone for the operator's user_id (default UTC). */
export async function settingsTimezoneGet(
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

/** PUT { iana: "America/Bogota" } — persists IANA + derived hours
 *  offset. The engine's circadian math re-reads user_profiles on
 *  every telemetry call, so a settings change shows up on the very
 *  next /limbic-state without restarting anything. */
export async function settingsTimezonePut(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: { iana?: unknown };
  try {
    body = await readJsonBody(req) as { iana?: unknown };
  } catch {
    return sendError(res, 400, "BAD_BODY", "invalid JSON body");
  }
  const iana = String(body.iana ?? "").trim();
  if (!iana) return sendError(res, 400, "INVALID_INPUT", "iana required");
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

/** Full IANA timezone list (≈400 entries) — Node ≥18 + ICU.
 *  Cached at the edge for an hour; the list barely changes. */
export async function timezones(
  _ctx: UiRouterContext,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const intlAny = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  const list = typeof intlAny.supportedValuesOf === "function"
    ? intlAny.supportedValuesOf("timeZone")
    : ["UTC", "America/Bogota", "America/New_York", "Europe/Madrid"];
  res.setHeader("Cache-Control", "public, max-age=3600");
  sendJson(res, 200, { timezones: list });
}
