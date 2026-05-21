/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Shared helpers for the UI HTTP route handlers. Extracted from
// ui-routes.ts (doctrine A1 — keep modules within 300-800 LOC). Every
// handler in routes/*.ts imports from here: send helpers, query
// parsing, db-error sanitization, listener probe, pagination, body
// reader, and the UiRouterContext shape.

import type { IncomingMessage, ServerResponse } from "node:http";
import * as net from "node:net";
import type { Pool } from "pg";

// ─── send helpers ──────────────────────────────────────────────────────

export function sendJson(
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

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { error: { code, message } });
}

// ─── request parsing ───────────────────────────────────────────────────

export function parseQuery(req: IncomingMessage): URLSearchParams {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  return url.searchParams;
}

/** Per-request guard: reject requests with absurdly long URLs.
 *  Defense-in-depth against DoS via pathological query strings. */
export const MAX_URL_BYTES = 8 * 1024;

export function urlTooLarge(req: IncomingMessage): boolean {
  return (req.url ?? "").length > MAX_URL_BYTES;
}

/** Read a JSON body with a hard size cap. Throws on parse error so
 *  the caller can map it to a 400. */
export async function readJsonBody(
  req: IncomingMessage,
  maxBytes = 32 * 1024,
): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) {
      const err = new Error("payload too large");
      (err as Error & { code?: string }).code = "PAYLOAD_TOO_LARGE";
      throw err;
    }
  }
  return body ? JSON.parse(body) : {};
}

/** Pagination helpers used by /skills, /memories, /journal. Default 20
 *  per page, capped at 200; offset capped at 1M to keep skipping work
 *  bounded. Matches the legacy ui-routes.ts behaviour. */
export function paginate(req: IncomingMessage): { limit: number; offset: number } {
  const q = parseQuery(req);
  let limit = parseInt(q.get("limit") ?? "20", 10);
  let offset = parseInt(q.get("offset") ?? "0", 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  limit = Math.min(limit, 200);
  offset = Math.min(offset, 1_000_000);
  return { limit, offset };
}

// ─── db error sanitizer ────────────────────────────────────────────────

/** Map PG / engine error strings to a stable, non-leaky surface.
 *  Doctrine G1: reason is plugin-local, message is user-facing. */
export function sanitizeDbError(err: unknown): string {
  if (err instanceof Error) {
    const s = err.message;
    if (/duplicate key/i.test(s)) return "duplicate value";
    if (/violates foreign key/i.test(s)) return "referenced row missing";
    if (/null value in column/i.test(s)) return "required field missing";
    if (/violates check constraint/i.test(s)) return "constraint violation";
    if (/permission denied/i.test(s)) return "operation denied";
    if (/relation .* does not exist/i.test(s)) return "internal: schema mismatch";
    return "internal db error";
  }
  return "internal error";
}

// ─── listener probe (for /health) ──────────────────────────────────────

export function probeListener(
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
// The adapter calls makeUiRouter(...) with this once; the returned
// handlers object exposes a function per endpoint that the adapter
// wires into registerHttpRoute. No globals — everything lives behind
// these closures.

export interface UiRouterContext {
  pool: Pool;
  /** Engine reference for getLimbicState / getCircadianTelemetry. */
  engine?: {
    getLimbicState?: (userId: string) => Promise<unknown>;
    getCircadianTelemetry?: (userId: string) => Promise<unknown>;
  };
  userId: string;
  engineConfig: {
    databaseUrl?: string;
    qdrantUrl?: string;
    valkeyUrl?: string;
  };
  teiUrl?: string;
  plugin: {
    id: string;
    version: string;
    edition: "hard" | "lite";
  };
  seedState?: {
    version: string;
    appliedAt: string;
  };
  installedAt?: string;
  /** Agent id this plugin runs under. */
  agentId?: string;
  /** Active ethics mode label (off|radar|enforce). */
  ethicsMode?: string;
  /** Captured `api.enqueueNextTurnInjection` reference. Null on hosts
   *  that don't expose the seam — /inbox/inject returns 503. */
  inboxEnqueue?: ((injection: {
    sessionKey: string;
    text: string;
    idempotencyKey?: string;
    placement?: "prepend_context" | "append_context";
    ttlMs?: number;
    metadata?: Record<string, unknown>;
  }) => Promise<{ enqueued: boolean; id: string; sessionKey: string }>) | null;
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}

// ─── handler type ──────────────────────────────────────────────────────

export type UiRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;
