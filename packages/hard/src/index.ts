/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// @celiumsai/cognition (Hard) — OpenClaw plugin entry, storage = pg-triple.
//
// Fase 1 scaffold placeholder. Fase 3 implements the real entry here
// following the verified SDK contract (definePluginEntry from
// "openclaw/plugin-sdk/plugin-entry"; canonical reference:
// openclaw/extensions/memory-core + memory-lancedb). Also adds in Fase 3:
//   openclaw.plugin.json   manifest (kind: "memory")
//   src/setup.ts           docker-compose orchestrator
//   src/compose/docker-compose.yml
// (HANDOFF §2.1, §3, §5 Fase 3).

export const COGNITION_HARD_SCAFFOLD = true as const;
export const STORAGE = "pg-triple" as const;
