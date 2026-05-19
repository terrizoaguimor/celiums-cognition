/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 * Originally derived from celiums-memory v2.0
 * (https://github.com/terrizoaguimor/celiums-memory, Apache 2.0)
 */

// @celiumsai/cognition-engine — vendored Celiums Memory cognitive engine.
//
// Fase 1 scaffold placeholder. Fase 2 vendorizes the real engine here:
//   ethics/  journal/  pad-circadian/  retrieval/  tools/  adapters/
// (HANDOFF §2.3). This file becomes the public barrel for the engine.

export const COGNITION_ENGINE_SCAFFOLD = true as const;

/** Set in Fase 2 to the celiums-memory upstream tag the engine was vendored from. */
export const VENDORED_FROM = "celiums-memory@v2.0 (pending Fase 2)" as const;
