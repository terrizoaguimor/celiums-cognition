/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// @celiumsai/cognition-shared — public surface used by @celiumsai/cognition
// to stand up the OpenClaw plugin.

export { createCognitionPlugin, type EditionOptions } from "./plugin-adapter/index.js";
export {
  BASE_CONFIG_SCHEMA,
  BASE_UI_HINTS,
  DEFAULT_TRIVIAL_SKIP_REGEX,
  parseConfig,
  withEditionProps,
  type CognitionConfig,
  type ExposedTools,
} from "./config-schema/index.js";
export {
  CURATED_TOOL_NAMES,
  selectTools,
  type EngineToolLike,
} from "./tool-curator/index.js";
export { definePluginEntry, type OpenClawPluginApi } from "./api.js";
