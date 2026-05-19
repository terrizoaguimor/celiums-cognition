/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// SDK shim — the ONLY place we import the OpenClaw plugin SDK from.
// Mirrors extensions/memory-lancedb/api.ts (the verified external-plugin
// reference, HANDOFF §10.1). Keeping the import path in one file means a
// single edit if the SDK entrypoint ever moves.
export {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";
