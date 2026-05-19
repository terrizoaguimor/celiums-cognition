// Prepend the HANDOFF §2.3 provenance header to every vendored engine/.ts and
// memory-types/.ts. Idempotent: skips files that already carry the marker.
// Preserves the file's existing `// SPDX-License-Identifier: Apache-2.0` lines.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HEADER = `/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 * Originally derived from celiums-memory v2.0
 * (https://github.com/terrizoaguimor/celiums-memory, Apache 2.0)
 */
`;
const MARKER = "Originally derived from celiums-memory v2.0";
const ROOTS = [
  "/Volumes/My Book/Documents/celiums-cognition/packages/engine/src",
  "/Volumes/My Book/Documents/celiums-cognition/packages/memory-types/src",
];

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}

let applied = 0, skipped = 0, total = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    total++;
    const src = readFileSync(file, "utf8");
    if (src.includes(MARKER)) { skipped++; continue; }
    writeFileSync(file, HEADER + src);
    applied++;
  }
}
console.log(`vendor headers: applied=${applied} skipped=${skipped} total=${total}`);
