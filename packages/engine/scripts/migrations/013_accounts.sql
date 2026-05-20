-- 013_accounts.sql — single-account auth for the Celiums Cognition Hard UI.
--
-- The plugin is single-tenant by design: one installation = one operator.
-- A CHECK constraint pins accounts.id to 1 so the table can hold at most
-- one row. Multi-user is intentionally out of scope (CLAUDE.md decision
-- 2026-05-20 with Mario: this is a hardwork enterprise plugin for the
-- instance owner, not a SaaS).
--
-- Password hashing: PBKDF2-SHA256 with 600k iterations, salt random per
-- account. Stored as "pbkdf2-sha256$<iters>$<salt_b64>$<hash_b64>".
-- We deliberately avoid argon2/bcrypt to dodge native builds (the install
-- recipe uses --ignore-scripts; see CLAUDE.md §3 deviation 8).
--
-- TOTP secret stored as base32 plaintext. The DB is local-disk only in the
-- Hard edition (docker compose bind 127.0.0.1:5432), so at-rest encryption
-- is the operator's responsibility (disk encryption, ZFS native, etc).
-- We don't add an envelope cipher here because key management would push
-- complexity into the plugin without meaningful improvement on a single-
-- host install.
--
-- Recovery codes stored as sha256 hex of the uppercase code. Each code
-- consumed (removed from the array) on use.

CREATE TABLE IF NOT EXISTS accounts (
  id                    integer PRIMARY KEY CHECK (id = 1),
  username              text NOT NULL UNIQUE,
  email                 text NOT NULL UNIQUE,
  password_hash         text NOT NULL,
  totp_secret           text NOT NULL,
  totp_enabled          boolean NOT NULL DEFAULT false,
  recovery_codes_hashed text[] NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz
);

-- Server-side session store. Cookie carries the session id (opaque random
-- 32 bytes b64url), the row carries the scope + expiry. Lookup is a single
-- PK fetch; deleting the row invalidates the session.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id            text PRIMARY KEY,
  account_id    integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope         text NOT NULL CHECK (scope IN ('pending_totp_setup','pending_totp_login','active')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
  ON auth_sessions (expires_at);
