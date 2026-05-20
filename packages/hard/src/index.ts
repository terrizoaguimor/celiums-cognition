/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// @celiumsai/cognition (Hard) — OpenClaw plugin entry, storage = pg-triple
// (Postgres 17 + pgvector, Qdrant, Valkey). The local stack is provisioned
// AUTOMATICALLY by the shared adapter's service.start fallback (CLAUDE.md
// §3b directive: zero manual setup). Manual entry point still available
// via the `bin: celiums-cognition` (src/setup.ts).

import { createCognitionPlugin, withEditionProps } from "@celiumsai/cognition-shared";
import { setup } from "./setup.js";

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
      "postgresql://celiums:celiums@localhost:5432/celiums_memory";
    const qdrantUrl = process.env.CELIUMS_QDRANT_URL ?? "http://localhost:6333";
    const valkeyUrl = process.env.CELIUMS_VALKEY_URL ?? "redis://localhost:6379";
    return {
      databaseUrl,
      qdrantUrl,
      valkeyUrl,
      qdrantApiKey: process.env.CELIUMS_QDRANT_API_KEY,
      personality: "celiums",
    } as never;
  },
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
