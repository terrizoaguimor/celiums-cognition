/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// `celiums-cognition setup` — provisions the local Hard stack
// (Postgres + Qdrant + Valkey) via docker compose and waits for health.
// HANDOFF §4.1 setup flow. Pure orchestration; no secrets are written.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const COMPOSE = join(dirname(fileURLToPath(import.meta.url)), "compose", "docker-compose.yml");

function run(cmd: string, args: string[]): number {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  return r.status ?? 1;
}

export async function setup(): Promise<number> {
  // Prefer `docker compose` (v2); fall back to `docker-compose` (v1).
  const probe = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  const composeArgs =
    probe.status === 0
      ? ["compose", "-f", COMPOSE, "up", "-d", "--wait"]
      : null;

  if (!composeArgs) {
    console.error(
      "[celiums-cognition] Docker (with `docker compose`) is required for the Hard edition.\n" +
        "Install Docker/OrbStack, or use @celiumsai/cognition-lite (zero infra).",
    );
    return 1;
  }

  console.log(`[celiums-cognition] Provisioning local stack via ${COMPOSE}`);
  console.log("[celiums-cognition] First run pulls images (~60-90s).");
  const code = run("docker", composeArgs);
  if (code !== 0) {
    console.error("[celiums-cognition] docker compose failed.");
    return code;
  }
  console.log(
    "[celiums-cognition] Stack healthy: Postgres :5432, Qdrant :6333, Valkey :6379.\n" +
      "[celiums-cognition] The plugin will connect on next agent run.",
  );
  return 0;
}

// CLI entry: `node dist/setup.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  setup().then((code) => process.exit(code));
}
