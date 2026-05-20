#!/usr/bin/env node
/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// prepack — strip workspace-only deps from package.json before pack/publish.
//
// `@celiumsai/cognition-shared` is declared as a workspace devDep so pnpm
// symlinks it locally for typecheck + bundling. tsup's noExternal
// (tsup.config.ts) inlines its code into dist/index.js, so the manifest
// shipped to consumers MUST NOT advertise it as a real dep — otherwise:
//   • npm install <tarball> tries to resolve "workspace:*" → EUNSUPPORTEDPROTOCOL
//   • npm install <tarball> with pnpm-transformed "0.1.0" → ENOTFOUND (shared
//     is private: true, never on the npm registry).
// Either failure mode blocked deploys to the VPS on 2026-05-19 (manual jq
// hack in production). This script makes the publish flow self-healing.
//
// Pairs with scripts/postpack.mjs (restore the original after pack).

import { readFileSync, writeFileSync } from "node:fs";

const PKG = "package.json";
const BACKUP = ".package.json.prepack-bak";

// Workspace deps that tsup's noExternal embeds into dist/ — must NOT appear
// in the published manifest. Mirror tsup.config.ts noExternal regex.
const STRIP_FROM_DEV = ["@celiumsai/cognition-shared"];

const original = readFileSync(PKG, "utf8");
writeFileSync(BACKUP, original);

const pkg = JSON.parse(original);
for (const name of STRIP_FROM_DEV) {
  if (pkg.devDependencies?.[name] !== undefined) {
    delete pkg.devDependencies[name];
  }
}

writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");
process.stdout.write(`[prepack] stripped workspace devDeps: ${STRIP_FROM_DEV.join(", ")}\n`);
