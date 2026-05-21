/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// SDK contracts — snapshot of the OpenClaw SDK shapes this plugin
// depends on, plus a runtime validator that compares an inbound
// payload against the snapshot.
//
// Why this file exists (Mario 2026-05-21):
// > "No queremos reescribir nada del SDK, pero debemos de poder
// >  sobrevivir a los cambios."
//
// OpenClaw is on an active release cadence. Any hook payload or
// register* signature can drift between minor versions. Without
// runtime validation, the symptom of drift is an unhelpful
// `Cannot read properties of undefined` that crashes the agent
// turn. With this module, drift becomes:
//
//   1. A warn log naming the field that changed.
//   2. A skipped hook for THIS event (plugin keeps running).
//   3. A clear signal to update the snapshot.
//
// Verified against OpenClaw 2026.5.19-beta.1 (installed in
// node_modules/openclaw/dist/hook-types-CaX_Eg5O.d.ts at the time
// of writing). Each shape carries a `versionTag` so a future diff
// is easy to spot.

// ─── shape descriptor ──────────────────────────────────────────────────
// Each descriptor lists the fields WE READ from the SDK payload.
// We deliberately don't mirror every field the SDK declares — that
// invites false drift alarms when the SDK adds optional fields. We
// only fail when a field we depend on is missing or wrong-type.

export type PrimitiveType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "function"
  | "uuid"
  | "any";

export interface FieldSpec {
  /** Dot-separated path, e.g. "requester.threadId". */
  path: string;
  /** Expected type. "any" accepts everything that exists (just checks presence). */
  type: PrimitiveType;
  /** When true, missing or wrong-type causes the validator to flag drift.
   *  Optional fields are checked only when present. */
  required: boolean;
  /** For "string" fields, optional enum constraint. Missing → no constraint. */
  oneOf?: readonly string[];
}

export interface ShapeSpec {
  /** Stable identifier — appears in warn logs. */
  name: string;
  /** SDK version this snapshot was verified against. */
  versionTag: string;
  fields: readonly FieldSpec[];
}

// ─── shapes we depend on ──────────────────────────────────────────────

/** PluginHookBeforePromptBuildEvent — used by auto-recall + turn_context wire. */
export const BEFORE_PROMPT_BUILD_EVENT: ShapeSpec = {
  name: "before_prompt_build/event",
  versionTag: "openclaw@2026.5.19-beta.1",
  fields: [
    { path: "prompt", type: "string", required: false },
    { path: "messages", type: "array", required: false },
  ],
} as const;

/** PluginHookAgentEndEvent — used by auto-capture + auto-journal. */
export const AGENT_END_EVENT: ShapeSpec = {
  name: "agent_end/event",
  versionTag: "openclaw@2026.5.19-beta.1",
  fields: [
    { path: "success", type: "boolean", required: false },
    { path: "messages", type: "array", required: false },
  ],
} as const;

/** PluginHookSubagentSpawnBase — superset used by spawning/spawned events. */
export const SUBAGENT_SPAWN_BASE_EVENT: ShapeSpec = {
  name: "subagent_spawn/base",
  versionTag: "openclaw@2026.5.19-beta.1",
  fields: [
    { path: "childSessionKey", type: "string", required: true },
    { path: "agentId", type: "string", required: true },
    { path: "label", type: "string", required: false },
    { path: "mode", type: "string", required: true, oneOf: ["run", "session"] },
    { path: "threadRequested", type: "boolean", required: true },
    { path: "requester.channel", type: "string", required: false },
    { path: "requester.accountId", type: "string", required: false },
  ],
} as const;

/** PluginHookSubagentEndedEvent — used by Fase B end hook. */
export const SUBAGENT_ENDED_EVENT: ShapeSpec = {
  name: "subagent_ended/event",
  versionTag: "openclaw@2026.5.19-beta.1",
  fields: [
    { path: "targetSessionKey", type: "string", required: true },
    { path: "targetKind", type: "string", required: true, oneOf: ["subagent", "acp"] },
    { path: "reason", type: "string", required: true },
    { path: "outcome", type: "string", required: false,
      oneOf: ["ok", "error", "timeout", "killed", "reset", "deleted"] },
    { path: "runId", type: "string", required: false },
    { path: "endedAt", type: "number", required: false },
    { path: "error", type: "string", required: false },
    { path: "accountId", type: "string", required: false },
  ],
} as const;

/** PluginHookBeforeCompactionEvent — Fase A. */
export const BEFORE_COMPACTION_EVENT: ShapeSpec = {
  name: "before_compaction/event",
  versionTag: "openclaw@2026.5.19-beta.1",
  fields: [
    { path: "messageCount", type: "number", required: false },
    { path: "compactingCount", type: "number", required: false },
    { path: "tokenCount", type: "number", required: false },
  ],
} as const;

/** PluginHookAgentContext — supplied to every hook, carries agentId/session. */
export const AGENT_CONTEXT: ShapeSpec = {
  name: "agent_context",
  versionTag: "openclaw@2026.5.19-beta.1",
  fields: [
    { path: "agentId", type: "string", required: false },
    { path: "sessionId", type: "string", required: false },
    { path: "sessionKey", type: "string", required: false },
    { path: "conversationId", type: "string", required: false },
  ],
} as const;

// ─── validator ─────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  /** When invalid, one entry per drifted field. Examples:
   *   "childSessionKey: required string but got undefined"
   *   "mode: expected one of [run,session] but got 'turn'"
   */
  drift: string[];
}

/** Get a nested field via dot path. Returns `undefined` if any
 *  intermediate node is null/undefined/not-an-object. */
function getPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function typeMatches(value: unknown, expected: PrimitiveType): boolean {
  if (expected === "any") return value !== undefined;
  if (expected === "array") return Array.isArray(value);
  if (expected === "uuid") {
    return typeof value === "string"
      && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
  }
  if (expected === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  return typeof value === expected;
}

/** Validate `payload` against `shape`. Pure — no logging.
 *  Returns `{valid: true, drift: []}` on match. */
export function validateShape(
  payload: unknown,
  shape: ShapeSpec,
): ValidationResult {
  const drift: string[] = [];
  for (const field of shape.fields) {
    const value = getPath(payload, field.path);
    if (value === undefined || value === null) {
      if (field.required) {
        drift.push(`${field.path}: required ${field.type} but got ${value === undefined ? "undefined" : "null"}`);
      }
      // Optional + absent: fine.
      continue;
    }
    if (!typeMatches(value, field.type)) {
      drift.push(
        `${field.path}: expected ${field.type} but got ${Array.isArray(value) ? "array" : typeof value}`,
      );
      continue;
    }
    if (field.oneOf && typeof value === "string" && !field.oneOf.includes(value)) {
      drift.push(
        `${field.path}: expected one of [${field.oneOf.join(",")}] but got '${value}'`,
      );
    }
  }
  return { valid: drift.length === 0, drift };
}

// ─── wrapping helper ───────────────────────────────────────────────────

export interface SdkResilienceLogger {
  warn?: (m: string) => void;
}

/**
 * Wrap a hook handler so it validates the event against the snapshot
 * shape BEFORE running. If drift is detected:
 *   - logs a warn line naming the shape + the drifted fields
 *   - returns `undefined` (the handler is skipped for this event)
 *   - the plugin keeps running; the next event tries again
 *
 * Drift is logged at most once per shape per process (the first time
 * it's seen) to avoid log flooding. A subsequent matching event still
 * skips the handler, but quietly.
 */
const _driftLoggedShapes = new Set<string>();

export function withShapeValidation<E, C, R>(
  shape: ShapeSpec,
  handler: (event: E, ctx: C) => R | Promise<R>,
  logger?: SdkResilienceLogger,
): (event: unknown, ctx: unknown) => Promise<R | undefined> {
  return async (event, ctx) => {
    const result = validateShape(event, shape);
    if (!result.valid) {
      if (!_driftLoggedShapes.has(shape.name)) {
        _driftLoggedShapes.add(shape.name);
        logger?.warn?.(
          `celiums-cognition: SDK shape drift on ${shape.name} (verified against ${shape.versionTag}) — ` +
          `handler skipped. Drift: ${result.drift.join("; ")}. Update sdk-contracts.ts to match the new SDK.`,
        );
      }
      return undefined;
    }
    return handler(event as E, ctx as C);
  };
}

/**
 * Feature-detect a register* method on the api object. Returns the
 * bound function when present, undefined when the host SDK doesn't
 * expose it. Caller logs the absence at info level so operators see
 * which seams are missing on their gateway version.
 */
export function detectApiMethod<T extends string>(
  api: unknown,
  method: T,
): ((...args: unknown[]) => unknown) | undefined {
  if (!api || typeof api !== "object") return undefined;
  const m = (api as Record<string, unknown>)[method];
  return typeof m === "function" ? (m as never) : undefined;
}
