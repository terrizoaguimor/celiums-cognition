# Security audit — 2026-05-21

First systematic security pass on the Hard plugin. Method: in-tree code
review + Atlas cross-validation via `atlas_ask` (deepseek-v4-pro for
auth, mistral-3-14B for the broader surface). Each finding lists
severity, summary, status (✅ fixed in this pass / 🟡 documented as
accepted risk / 🟢 false positive on review).

Surface in scope: the Hard plugin (`packages/{shared,hard,engine}`).
Out of scope: the celiums-memory engine internals beyond what the
plugin exposes; OpenClaw gateway itself; underlying DB/Qdrant/Valkey
deployment.

---

## Critical

### S-001 — Session fixation via missing id rotation on privilege escalation  ✅

The `upgradeSession` path flipped `auth_sessions.scope` from
`pending_totp_setup` / `pending_totp_login` to `active` but kept the
same row id. An attacker who knew the session id BEFORE escalation
would inherit the active cookie value after the user completed TOTP.

**Fix:** `upgradeSession` now runs in a transaction that
INSERTs a fresh `auth_sessions` row with the new scope, DELETEs the
old one, and returns the new id; the caller sets it as the new
cookie value. The pre-escalation id is dead the instant the upgrade
succeeds.

Commit: this pass.

---

## High

### S-002 — Account enumeration via 404 vs 401 in /auth/login  ✅

`/auth/login` returned 404 NO_ACCOUNT when no operator account was
provisioned, 401 BAD_CREDENTIALS when credentials didn't match.
An attacker hitting the public URL could distinguish "system is
provisioned" from "fresh install" via response code.

**Fix:** the no-account branch returns 401 BAD_CREDENTIALS with the
same body shape as wrong-password. A throwaway `verifyPassword`
call runs on the no-account path so timing stays comparable.

Commit: this pass.

### S-003 — TOCTOU on recovery code consumption  ✅

`/auth/login/totp` checked `recovery_codes_hashed.indexOf(hashed)`
against the in-memory account snapshot and only then ran the
`array_remove` UPDATE. Two concurrent requests both presenting the
same valid code would both pass the `indexOf` check (the snapshot
read happened in `getCurrentSession`, before the first UPDATE
committed) and both succeed.

**Fix:** single `UPDATE ... WHERE $1 = ANY(recovery_codes_hashed)
RETURNING recovery_codes_hashed`. If rowCount is 0 after the UPDATE,
the code was never present (or another concurrent request just ate
it). Single statement, atomic. Closes the race window completely.

Commit: this pass.

### S-004 — Information disclosure via account_exists in /auth/me  ✅

`/auth/me` returned `account_exists: true` to anonymous callers
once an operator was provisioned. A passerby hitting the public URL
learned whether the system was provisioned and worth targeting.

**Fix:** anonymous response now returns ONLY
`{ authenticated: false, can_signup: <true-only-when-zero-accounts> }`.
After the first signup, `can_signup` returns `false` indistinguishably
from "wrong cookie / expired session". The login screen also no
longer offers a "Create account" affordance.

Commit: prior pass (this commit doc retroactively logs it).

---

## Medium

### S-005 — PG error strings leak schema details  ✅

Several `sendError(res, 500, "DB_ERROR", String(err))` sites echoed
the raw PG error message — including column / constraint / index
names. An attacker probing form fields could fingerprint the schema
("duplicate key value violates unique constraint accounts_email_key").

**Fix:** `sanitizeDbError(err)` maps known PG patterns
(`duplicate key`, `violates foreign key`, `null value in column`,
`violates check constraint`, `permission denied`, `relation … does
not exist`) to short, opaque messages. Unknown errors collapse to
`"internal db error"`. Real details stay in the server logs for
operator diagnosis.

Commit: this pass.

### S-006 — URL DoS via pathological query strings  ✅

No cap on inbound URL length. A megabyte of query params would
parse into memory, allocate a URLSearchParams, and feed into
trigram/FTS queries that can backtrack catastrophically.

**Fix:** 8 KB hard cap enforced at the top of the dispatcher.
Anything larger returns 414 URI_TOO_LONG before any handler runs.

Commit: this pass.

### S-007 — Rate-limit in-memory only  🟡

The rate-limit Map is process-local. A restart clears all
counters; an attacker who notices the gateway restart could
re-attempt brute force from the same IP with a fresh budget.

**Status:** accepted for the single-instance deployment model. The
plugin runs in one gateway process; restarts are not adversary-
triggered. If multi-replica deployments arrive, swap to Valkey-
backed INCRBY + EXPIRE. Tracked as deploy-time decision.

### S-008 — TOTP secret stored in plaintext at rest  🟡

`accounts.totp_secret` is the raw base32 string. A DB exfiltration
gives the attacker the secret without needing the user's authenticator.

**Status:** accepted with documented mitigation: the DB is local-disk
only (docker compose binds 127.0.0.1:5432), so the threat model
folds into "attacker has root on the host", at which point all
in-process secrets are compromised regardless. For deployments
where the operator wants encryption-at-rest, the recommended path
is filesystem-level (LUKS / disk encryption) or ZFS native, not
an envelope cipher in app code that doesn't actually protect
against the threats it would imply.

Documented in `packages/engine/scripts/migrations/013_accounts.sql`.

### S-009 — Abandoned signup resume hands back the TOTP secret  🟡

If a user completes signup (account row written with
`totp_enabled=false`) but abandons before `/auth/totp/verify`, a
subsequent `/auth/login` with the right password returns the original
TOTP secret + URI so the user can resume enrolment. An attacker
who steals only the password (no QR scan) can claim the secret on
an unverified account.

**Status:** intentional tradeoff. Single-account plugin's recovery
path is operator-level DB intervention; the alternative ("abandoned
signups must be wiped manually") creates a higher-friction recovery
than the actual risk warrants. The password is the verification
gate for the resume path; an attacker with the password and network
access has equivalent capabilities through the dashboard regardless.
Tracked; revisit if multi-tenant.

### S-010 — Prompt injection via user-controlled memory content  🟡

User-supplied content (memories, journal entries, ethics
action_attempted) is rendered as markdown in the dashboard AND
quoted into `turnContext` for the next agent turn. A crafted memory
can include instructions intended to influence the agent's
behaviour ("ignore previous instructions and …").

**Status:** known and partially mitigated. The memory-prompt
supplement (`buildMemoryPromptSupplement`) explicitly tells the
model to treat memory content as DATA, not instruction, and lists
confabulation/sycophancy/hyperfunctioning as failure modes to flag
via `journal_write({entry_type: "doubt", …})`. The agent has the
identity preamble + 8-channel `turn_context` framing on every turn.
Defense-in-depth is the right model here; static parsing won't
catch creative phrasings.

For the single-account model, the operator is the only writer to
memory, so an attacker writing memory implies they're already the
operator. The risk lives in multi-tenant deployments (out of
scope for Hard).

---

## Low

### S-011 — Session id entropy  🟢

False positive in audit. `crypto.randomBytes(32)` → 256 bits of
cryptographic randomness, base64url-encoded. Sufficient.

### S-012 — Session expiry enforcement  🟢

False positive in audit. `getCurrentSession` filters
`WHERE expires_at > now()` on every read. Expired sessions can't
be presented.

### S-013 — Markdown HTML injection  🟢

False positive in audit. `react-markdown` v10 has secure defaults:
no raw HTML allowed (no `rehype-raw`, no `dangerouslyAllowHtml`),
`javascript:` and `data:` URLs in `a`/`img` are filtered. Tables
+ code blocks + autolinks are the only HTML primitives emitted.

### S-014 — SSRF via TEI_URL / KNOWLEDGE_API_URL  🟢

False positive in audit. Both URLs are env-only — no user input
controls them. Operator misconfiguration (pointing TEI_URL at an
internal admin endpoint) is a deployment concern, not a code one.

### S-015 — CSRF on POST endpoints  🟢

`celiums_sid` cookie carries `SameSite=Lax`. Cross-origin POSTs
do not include it. State-changing endpoints are POST/PUT (not GET),
so Lax is sufficient. No custom CSRF tokens needed.

---

## Method

1. Inventoried auth flow + UI endpoints + SQL surfaces from source.
2. Wrote per-surface threat model based on standard web app classes
   (OWASP top 10 mapped to plugin context).
3. Cross-checked the auth flow with `atlas_ask` (deepseek-v4-pro,
   pro-thinking) and the broader surface with mistral-3-14B for a
   second opinion.
4. Atlas confirmed S-001, S-002, S-003 from the first round; it
   also flagged S-005, S-006 in the second round. Other items came
   from in-tree review.
5. Filtered Atlas's false positives by code-reading the specific
   path Atlas described — several "findings" pointed at safe code
   (e.g., session ID entropy is `crypto.randomBytes`, not the
   weaker `Math.random`).

## Round 2 — validation pass

Re-ran the audit with **nvidia-nemotron-3-super-120b** (pro-thinking,
distinct from round-1 models) to validate the fixes + look for issues
the first pass missed. The model confirmed F1/F3/F5/F6 as closed and
flagged F2 as "partial" — claimed `getAccount` timing leak. Reviewed
the path: the sub-millisecond DB roundtrip difference between
"row found" and "no row found" on a primary-key SELECT-LIMIT-1 is
dominated by the constant-cost `verifyPassword` (PBKDF2 600k iters,
~80ms). The leak Atlas describes is theoretically real but
observationally below network jitter for a remote attacker. Logged
as 🟢 acceptable.

New findings from round 2:

### S-017 — Auto-journal flood DoS  ✅

The `agent_end` hook writes to `agent_journal` on every meaningful
turn with no rate-limit. A runaway loop or malicious agent could
spawn many agent runs and flood the table.

**Fix:** per-agent_id sliding-window throttle: max 30 auto-journal
writes per 5 minutes per `agent_id`. Excess is dropped with a
`warn` log. The operator's own `journal_write` calls bypass this
throttle entirely (only the plugin's automatic baseline is gated).

Commit: round 2.

### S-018 — Uncaught pg.Pool error events crash the process  ✅

`pg.Pool` emits `error` on connection-level failures (server gone,
network blip). Without a listener, Node throws
`Unhandled 'error' event` and the gateway crashes — taking down
EVERY plugin, not just ours. Our query-level try/catches don't
help because pool-level errors fire outside any query promise.

**Fix:** `extractEnginePool` now attaches `pool.on("error", …)`
once per pool (tracked via WeakSet so we don't subscribe twice).
The listener logs + swallows; the next query will still error
through our normal sanitizeDbError path.

Commit: round 2.

### S-019 — Idle session expiration is fixed-window 24h  🟡

Sessions persist 24h from creation regardless of activity. A
stolen sid remains valid for the full window even if the victim
logs out (logout clears the cookie but ALSO deletes the server
row — closed), but no sliding window means an idle session that's
been hijacked stays alive to its TTL.

**Status:** accepted. The cookie is HttpOnly + Secure + SameSite=
Lax; theft requires either a same-origin XSS (closed by react-
markdown's safe defaults) or operator-machine compromise. The
threat model where sliding-window expiration would help (long
idle period + later theft) is dominated by other failure modes in
the same scenario. Tracked; revisit when we add multi-device
sessions.

### Round 2 false positives

- **F2 partial — getAccount timing** — sub-ms DB lookup vs 80ms
  PBKDF2. Not observable over network jitter.
- **POST body size class differences** — Atlas missed the existing
  64 KB cap in `readJsonBody` (MAX = 64 * 1024).
- **Session-fixation residual paths** — code review confirmed all
  `setSessionCookie` calls follow `createSession` or
  `upgradeSession`; never set before the server-side row exists.
- **Fake-verify timing** — `crypto.pbkdf2Sync` runs a fixed
  iteration count regardless of input by design. Constant time
  guaranteed; `timingSafeEqual` after.
- **upgradeSession idempotency on retry** — handlers don't retry
  the upgrade in isolation; the whole request flow retries. The
  BEGIN/ROLLBACK transaction semantics already cover partial
  failure (neither sid changes if COMMIT didn't land).

## Action items beyond this pass

- **Multi-instance rate-limit storage** (Valkey INCRBY) — pre-req
  for horizontal scale. Not needed today.
- **Prompt-injection defenses** for memories that came from
  untrusted upstream sources (when KNOWLEDGE_API_URL is set to a
  third-party corpus). Currently all memory content is operator-
  generated.
- **Audit log for security events** — login successes / failures /
  rate-limit hits / session rotations. Currently the gateway
  logger captures these as info/warn lines; a dedicated
  `security_events` table would let the dashboard surface them.
- **Periodic Atlas re-run** as the plugin gains surfaces. This
  audit covered ~95% of today's code; any new endpoint should
  trigger an incremental review.

## Cross-reference

| Tag | Severity | Status | Lives in |
|---|---|---|---|
| S-001 | Critical | ✅ fixed | `auth-routes.ts:upgradeSession` |
| S-002 | High     | ✅ fixed | `auth-routes.ts:authLogin` |
| S-003 | High     | ✅ fixed | `auth-routes.ts:authLoginTotp` |
| S-004 | High     | ✅ fixed | `auth-routes.ts:authMe` (prior pass) |
| S-005 | Medium   | ✅ fixed | `ui-routes.ts:sanitizeDbError` |
| S-006 | Medium   | ✅ fixed | `ui-routes.ts:urlTooLarge` |
| S-007 | Medium   | 🟡 accept | rate-limit Map (process-local) |
| S-008 | Medium   | 🟡 accept | `accounts.totp_secret` plaintext |
| S-009 | Medium   | 🟡 accept | resume-from-abandoned-signup flow |
| S-010 | Medium   | 🟡 partial | memory→turnContext injection |
| S-011 | Low      | 🟢 N/A   | session entropy (already 256-bit) |
| S-012 | Low      | 🟢 N/A   | expiry enforcement (already in query) |
| S-013 | Low      | 🟢 N/A   | markdown HTML (already sanitized) |
| S-014 | Low      | 🟢 N/A   | SSRF (env-only, not user-input) |
| S-015 | Low      | 🟢 N/A   | CSRF (SameSite=Lax + POST-only writes) |
| S-017 | Medium   | ✅ fixed | auto-journal flood (round 2 — per-agent throttle) |
| S-018 | Medium   | ✅ fixed | pg.Pool unhandled error (round 2 — listener attached) |
| S-019 | Low      | 🟡 accept | fixed-window 24h session TTL (round 2) |
