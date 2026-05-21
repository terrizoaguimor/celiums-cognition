/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// @celiumsai/cognition (Hard) — OpenClaw plugin entry, storage = pg-triple
// (Postgres 17 + pgvector, Qdrant, Valkey). The local stack is provisioned
// AUTOMATICALLY by the shared adapter's service.start fallback (CLAUDE.md
// §3b directive: zero manual setup). Manual entry point still available
// via the `bin: celiums-cognition` (src/setup.ts).

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createCognitionPlugin, withEditionProps } from "@celiumsai/cognition-shared";
import { setup } from "./setup.js";

// Audit P0 #3: prefer a unique, locally-generated password over the
// legacy insecure default. setup.ts creates ~/.celiums-cognition/credentials.env
// on first install with a 256-bit random POSTGRES_PASSWORD; this loader
// reads it back so the plugin connects with the same credentials docker
// compose used to initdb the volume.
const CREDS_FILE = join(homedir(), ".celiums-cognition", "credentials.env");

function databaseUrlFromCredentialsFile(): string | null {
  try {
    if (!existsSync(CREDS_FILE)) return null;
    const txt = readFileSync(CREDS_FILE, "utf8");
    const get = (k: string): string | null => {
      const m = new RegExp(`^${k}=(.*)$`, "m").exec(txt);
      return m ? m[1].trim() : null;
    };
    const user = get("POSTGRES_USER") ?? "celiums";
    const password = get("POSTGRES_PASSWORD");
    const db = get("POSTGRES_DB") ?? "celiums_memory";
    if (!password) return null;
    return `postgresql://${user}:${encodeURIComponent(password)}@localhost:5432/${db}`;
  } catch {
    return null;
  }
}

/** Last-resort fallback when neither env nor credentials file is set.
 *  Emits a LOUD stderr warning so the operator notices they are running
 *  with the legacy insecure default before exposing the host. */
function legacyInsecureFallback(): string {
  console.warn(
    "[celiums-cognition] SECURITY WARNING: connecting to Postgres with the " +
    "legacy default `celiums:celiums` credentials. Run `node dist/setup.js` " +
    "to mint a unique password, or set CELIUMS_DATABASE_URL explicitly.",
  );
  return "postgresql://celiums:celiums@localhost:5432/celiums_memory";
}

// Migrations live in dist/migrations/ (copied by the build script from
// ../engine/scripts/migrations/). Service.start applies pending ones via
// the engine's migrations runner after the docker stack is healthy.
const __DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__DIR, "migrations");
const UI_STATIC_DIR = join(__DIR, "ui");

const HARD_PROPS = {
  database: {
    type: "object",
    additionalProperties: false,
    properties: { endpoint: { type: "string", default: "localhost:5432" } },
  },
};
const HARD_UI = {
  "database.endpoint": { label: "Postgres endpoint", placeholder: "localhost:5432" },
};

const { schema, uiHints } = withEditionProps(HARD_PROPS, HARD_UI);

export default createCognitionPlugin({
  id: "celiums-cognition",
  name: "Celiums Cognition",
  description:
    "Persistent emotional memory for OpenClaw — Hard (Postgres + Qdrant + Valkey).",
  configSchema: { schema, uiHints },
  resolveEngineConfig: () => {
    // Hard = full triple-store. Endpoints come from env (defaults match the
    // bundled docker-compose service ports). Presence of databaseUrl/qdrantUrl
    // makes the engine pick MemoryStore (PG+Qdrant+Valkey) — verified
    // createMemoryEngine() auto-detection.
    const databaseUrl =
      process.env.CELIUMS_DATABASE_URL ??
      databaseUrlFromCredentialsFile() ??
      legacyInsecureFallback();
    const qdrantUrl = process.env.CELIUMS_QDRANT_URL ?? "http://localhost:6333";
    const valkeyUrl = process.env.CELIUMS_VALKEY_URL ?? "redis://localhost:6379";
    // BGE-large-en-v1.5 (TEI default) is 1024-dim. The celiums-memory
    // engine defaults to 384 (sentence-transformers/all-MiniLM-L6-v2
    // legacy from v2.0) — explicitly override here so the Qdrant
    // collection and the `skills.embedding vector(1024)` schema stay
    // aligned with what TEI produces. Without this, the collection gets
    // created at 384 dims and every memory upsert errors out (silent
    // try/catch swallows it, vectors_count stays null forever).
    const embeddingDimensions = Number(process.env.CELIUMS_EMBEDDING_DIM ?? 1024);
    const embeddingEndpoint = process.env.TEI_URL
      ? `${process.env.TEI_URL.replace(/\/$/, "")}/embed`
      : "http://localhost:8080/embed";
    return {
      databaseUrl,
      qdrantUrl,
      valkeyUrl,
      qdrantApiKey: process.env.CELIUMS_QDRANT_API_KEY,
      embeddingDimensions,
      embeddingEndpoint,
      embeddingModel: process.env.CELIUMS_EMBEDDING_MODEL ?? "BAAI/bge-large-en-v1.5",
      personality: "celiums",
    } as never;
  },
  migrationsDir: MIGRATIONS_DIR,
  enableUiRoutes: true,
  uiStaticDir: UI_STATIC_DIR,
  pluginVersion: "0.1.0",
  bootstrap: async (_engineCfg, _api) => {
    // The shared adapter only calls this when the local listeners (5432,
    // 6333, 6379) are NOT responding. setup() runs `docker compose up
    // -d --wait` against dist/compose/docker-compose.yml; the compose
    // file binds to 127.0.0.1 (commit 66f2e50). Idempotent — if the
    // stack is already up, compose is a no-op.
    const code = await setup();
    if (code !== 0) {
      throw new Error(`celiums-cognition stack bootstrap exited with code ${code}`);
    }
  },
});
