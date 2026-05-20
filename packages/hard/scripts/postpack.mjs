#!/usr/bin/env node
/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// postpack — restore the workspace package.json after pack/publish.
// Pairs with scripts/prepack.mjs.

import { copyFileSync, existsSync, unlinkSync } from "node:fs";

const PKG = "package.json";
const BACKUP = ".package.json.prepack-bak";

if (existsSync(BACKUP)) {
  copyFileSync(BACKUP, PKG);
  unlinkSync(BACKUP);
  process.stdout.write("[postpack] restored package.json\n");
}
