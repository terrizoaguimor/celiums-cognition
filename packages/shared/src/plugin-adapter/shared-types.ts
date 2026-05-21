/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Shared type aliases used across plugin-adapter modules.
// Consolidates duplicates flagged by audit P1 #16 (PoolLike was redefined
// in 5 files with slightly different signatures; Logger in 2). Single
// source of truth lives here; each consumer imports.
//
// PoolLike is intentionally a structural subset of `pg.Pool` — only the
// surface the adapter modules actually use, so the engine's internal
// pool (which is the real type) plugs in without an explicit cast.

/** Minimal pool surface: parameterized query returning typed rows.
 *  The generic defaults to `Record<string, unknown>` so callers that
 *  do not annotate row shape still work. `rowCount` is optional —
 *  pglite returns it, pg.Pool returns it, our internal shims may not. */
export interface PoolLike {
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
}

/** Optional logger surface. Both methods are optional so consumers can
 *  pass partial implementations (e.g. only `warn` in error paths). */
export interface Logger {
  info?: (m: string) => void;
  warn?: (m: string) => void;
}

/** Audit P1 #12: five different agentId-resolution orders had drifted
 *  across hooks (`hookCtx ?? cfg`, `ctx ?? event ?? cfg`,
 *  `parentEntry ?? cfg`, `tracked ?? hookCtx ?? cfg`, etc.).
 *  `subagent_spawning` and `session_end` in particular misattributed
 *  to the root cfg.agentId when a more specific source was available.
 *
 *  This helper takes a precedence list and returns the first string
 *  source that is non-empty. The caller picks the order — for the
 *  canonical case (hook event), pass `[hookCtx?.agentId,
 *  event?.agentId]`; for spawning, prepend `parentEntry?.parentAgentId`;
 *  for session_end, prepend `tracked?.agentId`. The fallback is the
 *  configured root agentId.
 *
 *  Variadic-friendly so the call site reads top-down by priority. */
export function resolveAgentId(
  sources: ReadonlyArray<string | undefined | null>,
  fallback: string,
): string {
  for (const s of sources) {
    if (typeof s === "string" && s.length > 0) return s;
  }
  return fallback;
}
