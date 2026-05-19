/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// @celiumsai/cognition-lite (Lite) — OpenClaw plugin entry, storage = pglite.
//
// Fase 1 scaffold placeholder. Fase 4 (gated by the pglite+pgvector smoke,
// which PASSED in Fase 0 — pgvector 0.8.1, HNSW OK) implements:
//   src/index.ts          real entry, storage = pglite-embedded
//   src/postinstall.ts     downloads ethics corpus + verifies SHA-256
//   ../engine/.../adapters/pglite-embedded/  the embedded StorageAdapter
// (HANDOFF §2.1, §4.2, §5 Fase 4).

export const COGNITION_LITE_SCAFFOLD = true as const;
export const STORAGE = "pglite-embedded" as const;
