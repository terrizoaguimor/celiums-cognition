// Celiums Cognition (Hard) bundle config.
//
// A ClawHub plugin ships as dist/index.js loaded by the OpenClaw host. The
// host has NO access to our private workspace packages, so the engine +
// shared adapter MUST be bundled IN. Third-party engine deps stay external
// and are declared in package.json `dependencies` → npm installs them when
// `openclaw plugins install clawhub:celiums-cognition` runs. `openclaw`
// itself is host-provided (optional peer) and always external.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/setup.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  // Force-bundle the private workspace code (shared → engine → memory-types).
  noExternal: [/^@celiumsai\//, /^@celiums\/memory-types$/],
  // Host-provided; never bundle. Subpaths too (openclaw/plugin-sdk/*).
  external: ["openclaw", /^openclaw\//],
});
