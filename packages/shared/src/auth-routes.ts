/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Auth routes for the Celiums Cognition Hard UI.
//
// Single-account model: one installation = one operator. The first signup
// claims the account; subsequent signups return 409. See migration
// 013_accounts.sql for schema rationale.
//
// Session model: server-side rows in auth_sessions, cookie carries the id.
// Cookie is HttpOnly, Secure, SameSite=Lax. SameSite=Lax (not Strict)
// because the UI loads from the same origin and Lax already blocks the
// cross-site POSTs we care about, while keeping top-level navigation
// working.
//
// Endpoints:
//   GET    /auth/me                    — current session or 401
//   POST   /auth/signup                — create the single account
//   POST   /auth/totp/verify           — finalize TOTP enrollment
//   POST   /auth/login                 — username/password → pending_totp_login
//   POST   /auth/login/totp            — TOTP code or recovery code → active
//   POST   /auth/logout                — invalidate current session

import type { IncomingMessage, ServerResponse } from "node:http";
import * as crypto from "node:crypto";
import * as OTPAuth from "otpauth";
import type { Pool } from "pg";

// ─── constants ─────────────────────────────────────────────────────────

const PBKDF2_ITERS = 600_000;
const PBKDF2_KEYLEN = 32;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const COOKIE_NAME = "celiums_sid";
const RECOVERY_COUNT = 8;
const TOTP_ISSUER = "Celiums Cognition";

// ─── rate limiting ─────────────────────────────────────────────────────
// In-memory sliding-window counter per (route, identifier). Process-local
// — restart resets. Acceptable for a single-instance gateway plugin; the
// real defense in depth is the cost of an attack across the window, not
// any single restart bypass.
//
// Key shape: `${route}:${identifier}` where identifier is the client IP
// for pre-session attempts (login, signup) or the session id for
// post-credentials attempts (totp verify / login/totp).
//
// On exceed: 429 + Retry-After header so well-behaved clients back off.

const rateLimitState = new Map<string, number[]>();

interface RateLimitConfig {
  /** Bucket key (route name). */
  route: string;
  /** Hard cap of attempts per window. */
  max: number;
  /** Window in seconds. */
  windowSec: number;
}

function rateLimitCheck(
  key: string,
  cfg: RateLimitConfig,
  nowMs: number = Date.now(),
): { allowed: boolean; retryAfterSec: number; remaining: number } {
  const cutoff = nowMs - cfg.windowSec * 1000;
  const fullKey = `${cfg.route}:${key}`;
  const hits = (rateLimitState.get(fullKey) ?? []).filter((t) => t > cutoff);
  if (hits.length >= cfg.max) {
    const oldest = hits[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + cfg.windowSec * 1000 - nowMs) / 1000));
    // Keep the trimmed list so subsequent calls don't re-walk the whole
    // history; don't extend it (the attempt was refused).
    rateLimitState.set(fullKey, hits);
    return { allowed: false, retryAfterSec, remaining: 0 };
  }
  hits.push(nowMs);
  rateLimitState.set(fullKey, hits);
  return { allowed: true, retryAfterSec: 0, remaining: cfg.max - hits.length };
}

/** Resolve the client IP for rate-limit bucketing. Honours
 *  `x-forwarded-for` (Cloudflare/Traefik) and `cf-connecting-ip` —
 *  spoofable in raw-internet, but we're behind cloudflared so the
 *  upstream populates these. Falls back to socket.remoteAddress. */
function clientIp(req: IncomingMessage): string {
  const cf = (req.headers["cf-connecting-ip"] as string | undefined)?.split(",")[0]?.trim();
  if (cf) return cf;
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  if (xff) return xff;
  return req.socket?.remoteAddress ?? "unknown";
}

function sendRateLimit(res: ServerResponse, retryAfterSec: number, route: string): void {
  res.setHeader("Retry-After", String(retryAfterSec));
  sendError(
    res, 429, "RATE_LIMITED",
    `too many ${route} attempts — retry after ${retryAfterSec}s`,
  );
}

/** Periodic cleanup so the Map doesn't grow unbounded under sustained
 *  abuse (each unique IP creates an entry that lives at least one window).
 *  Runs every 5 minutes; cheap.  */
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateLimitState.entries()) {
    // Anything > 1 hour old is irrelevant for any of our buckets.
    const fresh = hits.filter((t) => t > now - 3600 * 1000);
    if (fresh.length === 0) rateLimitState.delete(key);
    else rateLimitState.set(key, fresh);
  }
}, 300 * 1000).unref?.();

// Per-route configs. Numbers tuned for "well-behaved client never
// hits these; brute-force attacker eats real cost".
const RL_SIGNUP:       RateLimitConfig = { route: "signup",       max: 3, windowSec: 3600 };  // 3/hour/IP
const RL_LOGIN:        RateLimitConfig = { route: "login",        max: 5, windowSec: 900 };   // 5/15min/IP
const RL_TOTP_VERIFY:  RateLimitConfig = { route: "totp_verify",  max: 5, windowSec: 300 };   // 5/5min/session
const RL_LOGIN_TOTP:   RateLimitConfig = { route: "login_totp",   max: 5, windowSec: 300 };   // 5/5min/session

// ─── helpers ───────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
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

async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 64 * 1024; // 64KB cap — auth payloads are small
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
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

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res: ServerResponse, sid: string): void {
  // Secure cookies — gateway runs behind cloudflared with TLS termination
  // at Cloudflare, so the connection to the browser is HTTPS. Setting
  // Secure unconditionally prevents accidental cookie leaks over plain
  // HTTP if the operator ever exposes the gateway directly.
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(sid)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`,
  );
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
}

// ─── crypto ────────────────────────────────────────────────────────────

function hashPassword(pwd: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(pwd, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, "sha256");
  return `pbkdf2-sha256$${PBKDF2_ITERS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(pwd: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iters = Number(parts[1]);
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  if (!Number.isFinite(iters) || iters < 1 || iters > 10_000_000) return false;
  const got = crypto.pbkdf2Sync(pwd, salt, iters, expected.length, "sha256");
  // timingSafeEqual requires equal-length buffers.
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

function newSessionId(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function makeRecoveryCode(): string {
  // 10 alphanumerics from an O/0/I/1-free alphabet, grouped XXXXX-XXXXX.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += alphabet[bytes[i] % alphabet.length];
  return s.slice(0, 5) + "-" + s.slice(5);
}

function hashRecovery(code: string): string {
  return crypto
    .createHash("sha256")
    .update(code.toUpperCase().replace(/\s+/g, ""))
    .digest("hex");
}

function newTotpSecret(): OTPAuth.Secret {
  return new OTPAuth.Secret({ size: 20 }); // 160 bits, RFC 6238 recommended
}

function verifyTotp(secretBase32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  // window=1 tolerates ±30s clock drift between client and server.
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

function totpAuthUri(
  secretBase32: string,
  username: string,
  email: string,
): string {
  const label = `${username}:${email}`;
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.toString();
}

// ─── types ─────────────────────────────────────────────────────────────

export interface AuthCtx {
  pool: Pool;
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}

interface AccountRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  totp_secret: string;
  totp_enabled: boolean;
  recovery_codes_hashed: string[];
  created_at: Date;
  last_login_at: Date | null;
}

interface SessionRow {
  id: string;
  account_id: number;
  scope: "pending_totp_setup" | "pending_totp_login" | "active";
  created_at: Date;
  expires_at: Date;
  last_seen_at: Date;
}

interface SessionWithAccount {
  session: SessionRow;
  account: AccountRow;
}

// ─── session lookup ────────────────────────────────────────────────────

/**
 * Resolve the current session (if any) from the request cookie.
 * Updates last_seen_at on hit. Returns null on miss/expired.
 */
async function getCurrentSession(
  ctx: AuthCtx,
  req: IncomingMessage,
): Promise<SessionWithAccount | null> {
  const sid = parseCookies(req)[COOKIE_NAME];
  if (!sid) return null;
  const { rows } = await ctx.pool.query<SessionRow & AccountRow>(
    `UPDATE auth_sessions s SET last_seen_at = now()
       WHERE s.id = $1 AND s.expires_at > now()
     RETURNING s.id, s.account_id, s.scope, s.created_at, s.expires_at, s.last_seen_at,
       (SELECT row_to_json(a) FROM accounts a WHERE a.id = s.account_id) AS _acct`,
    [sid],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as unknown as SessionRow & { _acct: AccountRow | null };
  if (!r._acct) return null;
  return {
    session: {
      id: r.id,
      account_id: r.account_id,
      scope: r.scope,
      created_at: r.created_at,
      expires_at: r.expires_at,
      last_seen_at: r.last_seen_at,
    },
    account: r._acct,
  };
}

async function createSession(
  ctx: AuthCtx,
  accountId: number,
  scope: SessionRow["scope"],
): Promise<string> {
  const sid = newSessionId();
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await ctx.pool.query(
    `INSERT INTO auth_sessions (id, account_id, scope, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [sid, accountId, scope, expires],
  );
  return sid;
}

/**
 * Privilege-escalation session upgrade — rotates the session id at the
 * same time as the scope change.
 *
 * Session-fixation defense (2026-05-21 audit, Atlas cross-check):
 * an attacker who somehow seeds a victim's pending_totp_setup cookie
 * before the victim completes enrolment would inherit the active
 * cookie if the id stayed stable across the scope flip. By emitting
 * a fresh id on every upgrade and deleting the old row, we guarantee
 * any pre-escalation knowledge of the session id is dead by the time
 * the session becomes useful.
 *
 * Returns the new session id so the caller can set it on the cookie.
 */
async function upgradeSession(
  ctx: AuthCtx,
  oldSid: string,
  scope: SessionRow["scope"],
): Promise<string> {
  const newSid = newSessionId();
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  // Single-statement chained transaction so the rotation is atomic —
  // either both rows update or neither does.
  await ctx.pool.query("BEGIN");
  try {
    const { rows } = await ctx.pool.query<{ account_id: number }>(
      `SELECT account_id FROM auth_sessions WHERE id = $1 LIMIT 1`,
      [oldSid],
    );
    if (rows.length === 0) {
      await ctx.pool.query("ROLLBACK");
      throw new Error("session not found for upgrade");
    }
    await ctx.pool.query(
      `INSERT INTO auth_sessions (id, account_id, scope, expires_at)
         VALUES ($1, $2, $3, $4)`,
      [newSid, rows[0].account_id, scope, expires],
    );
    await ctx.pool.query(`DELETE FROM auth_sessions WHERE id = $1`, [oldSid]);
    await ctx.pool.query("COMMIT");
  } catch (err) {
    try { await ctx.pool.query("ROLLBACK"); } catch { /* swallow */ }
    throw err;
  }
  return newSid;
}

async function deleteSession(ctx: AuthCtx, sid: string): Promise<void> {
  await ctx.pool.query(`DELETE FROM auth_sessions WHERE id = $1`, [sid]);
}

async function getAccount(ctx: AuthCtx): Promise<AccountRow | null> {
  const { rows } = await ctx.pool.query<AccountRow>(
    `SELECT id, username, email, password_hash, totp_secret, totp_enabled,
            recovery_codes_hashed, created_at, last_login_at
       FROM accounts WHERE id = 1 LIMIT 1`,
  );
  return rows[0] ?? null;
}

// ─── endpoint: /auth/me ────────────────────────────────────────────────

async function authMe(
  ctx: AuthCtx,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const sess = await getCurrentSession(ctx, req);
  if (!sess) {
    // To an unauthenticated caller we expose ONLY whether signup is
    // still possible (zero accounts in the DB) — never whether an
    // account already exists. This is single-tenant on purpose
    // (Mario 2026-05-21: "si ya está creado el usuario no debería de
    // poderse crear más usuarios"), and leaking `account_exists`
    // tells an attacker the system is in use and worth targeting.
    const acct = await getAccount(ctx);
    sendJson(res, 200, {
      authenticated: false,
      can_signup: !acct,
    });
    return;
  }
  sendJson(res, 200, {
    authenticated: sess.session.scope === "active",
    scope: sess.session.scope,
    can_signup: false,
    user: {
      username: sess.account.username,
      email: sess.account.email,
      totp_enabled: sess.account.totp_enabled,
      created_at: sess.account.created_at,
    },
  });
}

// ─── endpoint: /auth/signup ────────────────────────────────────────────

interface SignupBody {
  username?: unknown;
  email?: unknown;
  password?: unknown;
}

function validateSignup(body: SignupBody): {
  username: string;
  email: string;
  password: string;
} | { error: string } {
  const username = String(body.username ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (username.length < 3 || username.length > 32) {
    return { error: "username must be 3–32 chars" };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return { error: "username may contain only letters, digits, _ . -" };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return { error: "invalid email" };
  }
  if (password.length < 12 || password.length > 256) {
    return { error: "password must be 12–256 chars" };
  }
  return { username, email, password };
}

async function authSignup(
  ctx: AuthCtx,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Rate limit per IP — signup is single-shot in normal use; this
  // caps an attacker spamming bogus signups (which also probes
  // whether the account exists via the 409 vs 201 reply).
  const rl = rateLimitCheck(clientIp(req), RL_SIGNUP);
  if (!rl.allowed) return sendRateLimit(res, rl.retryAfterSec, "signup");
  let body: SignupBody;
  try {
    body = await readJsonBody<SignupBody>(req);
  } catch {
    return sendError(res, 400, "BAD_BODY", "invalid JSON body");
  }
  const v = validateSignup(body);
  if ("error" in v) {
    return sendError(res, 400, "INVALID_INPUT", v.error);
  }

  // Single-account: if a row already exists, reject. Race-safe via UNIQUE
  // on email/username + the CHECK (id=1) PK.
  const existing = await getAccount(ctx);
  if (existing) {
    return sendError(
      res,
      409,
      "ACCOUNT_EXISTS",
      "an account is already provisioned for this instance",
    );
  }

  const secret = newTotpSecret();
  const secretBase32 = secret.base32;
  const recoveryCodes = Array.from({ length: RECOVERY_COUNT }, makeRecoveryCode);
  const recoveryHashed = recoveryCodes.map(hashRecovery);

  await ctx.pool.query(
    `INSERT INTO accounts
       (id, username, email, password_hash, totp_secret, totp_enabled,
        recovery_codes_hashed)
     VALUES (1, $1, $2, $3, $4, false, $5)`,
    [
      v.username,
      v.email,
      hashPassword(v.password),
      secretBase32,
      recoveryHashed,
    ],
  );

  // Pending-TOTP session so the client can finalize enrollment without
  // re-authenticating with username/password.
  const sid = await createSession(ctx, 1, "pending_totp_setup");
  setSessionCookie(res, sid);

  ctx.logger?.info?.(`auth: account created for ${v.username} <${v.email}>`);

  sendJson(res, 201, {
    username: v.username,
    email: v.email,
    totp_secret: secretBase32,
    totp_uri: totpAuthUri(secretBase32, v.username, v.email),
    recovery_codes: recoveryCodes,
  });
}

// ─── endpoint: /auth/totp/verify ───────────────────────────────────────

async function authTotpVerify(
  ctx: AuthCtx,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const sess = await getCurrentSession(ctx, req);
  if (!sess) {
    return sendError(res, 401, "NO_SESSION", "no session");
  }
  // Brute-forcing a 6-digit code = 1M tries; with window=±1 step we
  // accept ~3 valid codes at any moment, so 1M/3 ≈ 333K tries to land.
  // Cap at 5/5min so even sustained attack takes years.
  const rl = rateLimitCheck(sess.session.id, RL_TOTP_VERIFY);
  if (!rl.allowed) return sendRateLimit(res, rl.retryAfterSec, "totp_verify");
  if (sess.session.scope !== "pending_totp_setup") {
    return sendError(
      res,
      403,
      "WRONG_SCOPE",
      `session scope ${sess.session.scope} cannot verify TOTP setup`,
    );
  }
  let body: { code?: unknown };
  try {
    body = await readJsonBody(req);
  } catch {
    return sendError(res, 400, "BAD_BODY", "invalid JSON body");
  }
  const code = String(body.code ?? "").replace(/\s+/g, "");
  if (!verifyTotp(sess.account.totp_secret, code)) {
    return sendError(res, 401, "BAD_CODE", "incorrect or expired code");
  }
  await ctx.pool.query(
    `UPDATE accounts SET totp_enabled = true, last_login_at = now() WHERE id = 1`,
  );
  const newSid = await upgradeSession(ctx, sess.session.id, "active");
  setSessionCookie(res, newSid);
  ctx.logger?.info?.(`auth: TOTP enrolled for ${sess.account.username}`);
  sendJson(res, 200, { ok: true });
}

// ─── endpoint: /auth/login ─────────────────────────────────────────────

async function authLogin(
  ctx: AuthCtx,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Brute-force defense — 5 attempts per 15 minutes per IP. With a
  // strong password (≥12 chars, mixed case, digits as the policy
  // enforces) this makes online guessing effectively impossible.
  const rl = rateLimitCheck(clientIp(req), RL_LOGIN);
  if (!rl.allowed) return sendRateLimit(res, rl.retryAfterSec, "login");
  let body: { username?: unknown; password?: unknown };
  try {
    body = await readJsonBody(req);
  } catch {
    return sendError(res, 400, "BAD_BODY", "invalid JSON body");
  }
  const identifier = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!identifier || !password) {
    return sendError(res, 400, "INVALID_INPUT", "username and password required");
  }
  const acct = await getAccount(ctx);
  // Account-enumeration defense (2026-05-21 audit, Atlas cross-check):
  // never distinguish "no account" from "bad credentials" — both
  // return 401. An attacker can already learn whether signup is open
  // via /auth/me's can_signup, but that's a single bit; this keeps the
  // login surface consistent regardless. Also keep a fake verify call
  // on the no-account path so timing stays comparable.
  if (!acct) {
    // Constant-time fake compare so an attacker can't distinguish
    // "no account" from "wrong password" via response timing.
    verifyPassword(password, "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    return sendError(res, 401, "BAD_CREDENTIALS", "invalid credentials");
  }
  // Match against username OR email, case-insensitive.
  const matchesIdent =
    acct.username.toLowerCase() === identifier ||
    acct.email.toLowerCase() === identifier;
  // Always run verifyPassword to keep timing similar between
  // wrong-username and wrong-password branches.
  const pwdOk = verifyPassword(password, acct.password_hash);
  if (!matchesIdent || !pwdOk) {
    return sendError(res, 401, "BAD_CREDENTIALS", "invalid credentials");
  }
  if (acct.totp_enabled) {
    const sid = await createSession(ctx, 1, "pending_totp_login");
    setSessionCookie(res, sid);
    sendJson(res, 200, {
      requires_totp: true,
      username: acct.username,
    });
    return;
  }
  // TOTP not enrolled — the user signed up but abandoned/failed step 2.
  // We refuse to log them in (defeating 2FA would be wrong), but we DO
  // hand them a pending_totp_setup session so the frontend can route
  // them straight into the QR + verify step without re-typing the
  // password. The TOTP secret stored at signup is reused.
  const sid = await createSession(ctx, 1, "pending_totp_setup");
  setSessionCookie(res, sid);
  ctx.logger?.warn?.(
    `auth: login refused for ${acct.username} — TOTP not enrolled, resuming setup`,
  );
  sendJson(res, 200, {
    requires_totp_setup: true,
    username: acct.username,
    totp_secret: acct.totp_secret,
    totp_uri: totpAuthUri(acct.totp_secret, acct.username, acct.email),
  });
}

// ─── endpoint: /auth/login/totp ────────────────────────────────────────

async function authLoginTotp(
  ctx: AuthCtx,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const sess = await getCurrentSession(ctx, req);
  if (!sess) {
    return sendError(res, 401, "NO_SESSION", "no session");
  }
  // Same brute-force surface as totp_verify, but during a login flow
  // (recovery codes also flow through here). Per-session bucket so
  // the attacker can't trade IPs for tries.
  const rl = rateLimitCheck(sess.session.id, RL_LOGIN_TOTP);
  if (!rl.allowed) return sendRateLimit(res, rl.retryAfterSec, "login_totp");
  if (sess.session.scope !== "pending_totp_login") {
    return sendError(
      res,
      403,
      "WRONG_SCOPE",
      `session scope ${sess.session.scope} cannot complete TOTP login`,
    );
  }
  let body: { code?: unknown; recovery_code?: unknown };
  try {
    body = await readJsonBody(req);
  } catch {
    return sendError(res, 400, "BAD_BODY", "invalid JSON body");
  }
  const code = body.code != null ? String(body.code).replace(/\s+/g, "") : "";
  const recoveryRaw =
    body.recovery_code != null ? String(body.recovery_code) : "";

  if (code) {
    if (!verifyTotp(sess.account.totp_secret, code)) {
      return sendError(res, 401, "BAD_CODE", "incorrect or expired code");
    }
  } else if (recoveryRaw) {
    const hashed = hashRecovery(recoveryRaw);
    // Atomic check-and-consume (2026-05-21 audit, Atlas cross-check):
    // single statement that removes the code IFF it's present and
    // returns the surviving array. If no row updated, the code wasn't
    // valid (or another concurrent request just consumed it). Closes
    // the TOCTOU window between the in-memory check and the DB write.
    const { rowCount, rows: updRows } = await ctx.pool.query<{
      remaining_codes: string[] | null;
    }>(
      `UPDATE accounts
          SET recovery_codes_hashed = array_remove(recovery_codes_hashed, $1)
        WHERE id = 1 AND $1 = ANY(recovery_codes_hashed)
        RETURNING recovery_codes_hashed AS remaining_codes`,
      [hashed],
    );
    if (rowCount === 0) {
      return sendError(res, 401, "BAD_RECOVERY", "invalid recovery code");
    }
    const remaining = updRows[0]?.remaining_codes?.length ?? 0;
    ctx.logger?.warn?.(
      `auth: recovery code consumed for ${sess.account.username} (${remaining} remaining)`,
    );
  } else {
    return sendError(res, 400, "INVALID_INPUT", "code or recovery_code required");
  }
  await ctx.pool.query(
    `UPDATE accounts SET last_login_at = now() WHERE id = 1`,
  );
  const newSid2 = await upgradeSession(ctx, sess.session.id, "active");
  setSessionCookie(res, newSid2);
  ctx.logger?.info?.(`auth: login complete for ${sess.account.username}`);
  sendJson(res, 200, { ok: true });
}

// ─── endpoint: /auth/logout ────────────────────────────────────────────

async function authLogout(
  ctx: AuthCtx,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const sid = parseCookies(req)[COOKIE_NAME];
  if (sid) await deleteSession(ctx, sid);
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

// ─── router ────────────────────────────────────────────────────────────

export interface AuthRouter {
  /** Dispatch /auth/<sub>. `subpath` is everything after "/auth". */
  dispatch: (
    req: IncomingMessage,
    res: ServerResponse,
    subpath: string,
  ) => Promise<void>;
  /** Resolve the current session for upstream handlers that gate on auth. */
  resolveSession: (req: IncomingMessage) => Promise<SessionWithAccount | null>;
}

export function makeAuthRouter(ctx: AuthCtx): AuthRouter {
  return {
    dispatch: async (req, res, subpath) => {
      try {
        if (req.method === "GET" && (subpath === "/me" || subpath === "/me/")) {
          return authMe(ctx, req, res);
        }
        if (req.method === "POST" && subpath === "/signup") {
          return authSignup(ctx, req, res);
        }
        if (req.method === "POST" && subpath === "/totp/verify") {
          return authTotpVerify(ctx, req, res);
        }
        if (req.method === "POST" && subpath === "/login") {
          return authLogin(ctx, req, res);
        }
        if (req.method === "POST" && subpath === "/login/totp") {
          return authLoginTotp(ctx, req, res);
        }
        if (req.method === "POST" && subpath === "/logout") {
          return authLogout(ctx, req, res);
        }
        sendError(res, 404, "NOT_FOUND", `no auth route for ${req.method} ${subpath}`);
      } catch (err) {
        ctx.logger?.warn?.(`auth handler error: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) {
          sendError(res, 500, "AUTH_ERROR", err instanceof Error ? err.message : String(err));
        }
      }
    },
    resolveSession: (req) => getCurrentSession(ctx, req),
  };
}
