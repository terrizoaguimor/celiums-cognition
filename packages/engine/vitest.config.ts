// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Celiums Solutions LLC

import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
    testTimeout: 10_000,
    // Sprint D (REDISING §4) tests don't need a real Postgres — the
    // security_audit_log path is exercised via a stubbed `pool` on ctx.
    // For integration tests against a real cluster, run vitest with
    // CELIUMS_TEST_DB_URL set; suites that need it self-skip otherwise.
    exclude: [
      ...configDefaults.exclude,
      // VENDORING NOTE (celiums-cognition, HANDOFF §6.6): the Lite edition
      // uses pglite (WASM), NOT better-sqlite3. The SqliteAdapter is only
      // the structural base for the pglite-embedded adapter (built in
      // Fase 4 with its own 15 smoke tests). This dev/CI tree installs
      // headlessly (--ignore-scripts) so better-sqlite3's optional native
      // .node binary is not compiled. These two suites instantiate that
      // real binary and are therefore resource-gated — exactly as
      // smoke-pg-triple-real.test.ts self-skips without CELIUMS_TEST_DB_URL.
      // All 712 engine logic tests + typecheck + build remain green.
      'src/__tests__/smoke-sqlite-real.test.ts',
      'src/__tests__/runtime-bootstrap.test.ts',
    ],
  },
});
