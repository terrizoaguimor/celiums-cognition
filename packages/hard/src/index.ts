/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// @celiumsai/cognition (Hard) — OpenClaw plugin entry, storage = pg-triple
// (Postgres 17 + pgvector, Qdrant, Valkey). Provision the local stack with
// `pnpm celiums-cognition setup` (src/setup.ts → docker compose).

import { createCognitionPlugin, withEditionProps } from "@celiumsai/cognition-shared";

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
});
