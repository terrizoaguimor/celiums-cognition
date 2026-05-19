/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Shared config schema for both editions (HANDOFF §3.2). This object is the
// single source of truth: it is embedded verbatim into each edition's
// openclaw.plugin.json `configSchema` (declarative) AND passed to
// definePluginEntry({ configSchema }) (runtime). Hard/Lite extend the
// `properties` with their storage-specific keys via `withEditionProps()`.
//
// JSON Schema 2020-12, additionalProperties:false (strict — verified the
// real memory-core manifest uses the same shape).

export type ExposedTools = "curated" | "all";

export interface CognitionConfig {
  agentId: string;
  userId?: string;
  ethics: { enabled: boolean; strictMode: boolean };
  journal: { enabled: boolean };
  autoRecall: { enabled: boolean; trivialSkipRegex: string };
  autoCapture: { enabled: boolean; minImportance: number };
  dreaming: { enabled: boolean };
  exposedTools: ExposedTools;
}

export const DEFAULT_TRIVIAL_SKIP_REGEX = "^(ok|si|no|gracias)[\\s.!?]*$";

// NOTE: no `$schema` key. OpenClaw's config validator (AJV) does not register
// the draft-2020-12 meta-schema and throws "no schema with key or ref
// https://json-schema.org/draft/2020-12/schema", breaking plugin load. The
// real memory-core manifest also omits it. (HANDOFF §3.2 example was wrong;
// caught by the DO nyc1 E2E 2026-05-19.)
export const BASE_CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    agentId: { type: "string", default: "main" },
    userId: { type: "string" },
    ethics: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
        strictMode: { type: "boolean", default: false },
      },
    },
    journal: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
      },
    },
    autoRecall: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
        trivialSkipRegex: { type: "string", default: DEFAULT_TRIVIAL_SKIP_REGEX },
      },
    },
    autoCapture: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
        minImportance: { type: "number", default: 0.3 },
      },
    },
    dreaming: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: false },
      },
    },
    exposedTools: {
      type: "string",
      enum: ["curated", "all"],
      default: "curated",
    },
  },
} as const;

export const BASE_UI_HINTS = {
  userId: { label: "User ID", placeholder: "e.g. mario" },
  "ethics.strictMode": { label: "Strict ethics mode", advanced: true },
  exposedTools: {
    label: "Tool surface",
    help: "curated = 8 essential tools, all = 60+ tools",
  },
} as const;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" && v ? v : d);
const num = (v: unknown, d: number): number => (typeof v === "number" && !Number.isNaN(v) ? v : d);

/**
 * Resolve raw `api.pluginConfig` into a fully-defaulted, typed config.
 * Defensive (never throws on missing/extra keys) — the host already
 * schema-validates against the manifest; this only applies defaults.
 */
export function parseConfig(raw: unknown): CognitionConfig {
  const c = obj(raw);
  const ethics = obj(c.ethics);
  const journal = obj(c.journal);
  const autoRecall = obj(c.autoRecall);
  const autoCapture = obj(c.autoCapture);
  const dreaming = obj(c.dreaming);
  const exposed = c.exposedTools === "all" ? "all" : "curated";
  const cfg: CognitionConfig = {
    agentId: str(c.agentId, "main"),
    ethics: { enabled: bool(ethics.enabled, true), strictMode: bool(ethics.strictMode, false) },
    journal: { enabled: bool(journal.enabled, true) },
    autoRecall: {
      enabled: bool(autoRecall.enabled, true),
      trivialSkipRegex: str(autoRecall.trivialSkipRegex, DEFAULT_TRIVIAL_SKIP_REGEX),
    },
    autoCapture: {
      enabled: bool(autoCapture.enabled, true),
      minImportance: num(autoCapture.minImportance, 0.3),
    },
    dreaming: { enabled: bool(dreaming.enabled, false) },
    exposedTools: exposed,
  };
  if (typeof c.userId === "string" && c.userId) cfg.userId = c.userId;
  return cfg;
}

/** Merge edition-specific properties (Hard: database.*, Lite: embeddings.*). */
export function withEditionProps(
  extraProps: Record<string, unknown>,
  extraUiHints: Record<string, unknown> = {},
) {
  return {
    schema: {
      ...BASE_CONFIG_SCHEMA,
      properties: { ...BASE_CONFIG_SCHEMA.properties, ...extraProps },
    },
    uiHints: { ...BASE_UI_HINTS, ...extraUiHints },
  };
}
