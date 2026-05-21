/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Closed taxonomy of journal-entry tags. Doctrine M3: a typed enum of
// the strings the plugin writes, plus parametric helpers for tags that
// embed identifiers, so the operator dashboard can filter / aggregate
// reliably and a refactor that renames a tag fails the build instead
// of silently splitting one tag into two.
//
// Adopted incrementally: the modules added during Fase B–F refactor to
// these constants; older paths (compaction, ethics) keep their strings
// until they are next touched. Add new tags HERE, never inline.
//
// Audit P1 #15 (2026-05-21).

// ─── lifecycle ─────────────────────────────────────────────────────────

export const TAG_SESSION_START = "session-start";
export const TAG_SESSION_END = "session-end";
export const TAG_COMPACTION = "compaction";

// ─── subagents (Fase B) ────────────────────────────────────────────────

export const TAG_SUBAGENT = "subagent";
export const TAG_SPAWNED_SUBAGENT = "spawned-subagent";
export const TAG_SUBAGENT_REFUSED = "subagent-refused";
export const TAG_LOOP_GUARD = "loop-guard";

// ─── operator-direct actions (Fase D) ──────────────────────────────────

export const TAG_OPERATOR_ACTION = "operator-action";
export const TAG_FORGET = "forget";
export const TAG_DESTRUCTIVE = "destructive";

// ─── auto-baseline (Fase F + agent_end) ────────────────────────────────

export const TAG_AUTO = "auto";
export const TAG_AGENT_END = "agent_end";
export const TAG_WITH_TOOLS = "with-tools";
export const TAG_TOOL_RESULT = "tool-result";
export const TAG_THROTTLED = "throttled";

// ─── parametric tags ───────────────────────────────────────────────────
// These embed an identifier — the prefix is closed; the suffix varies.
// Operators search by prefix; programmatic readers split on `:`.

/** "from-subagent:<childAgentId>" — parent's retrospective entry tagging
 *  which child it summarizes. */
export const tagFromSubagent = (childAgentId: string): string =>
  `from-subagent:${childAgentId}`;

/** "resumed-from:<shortSessionId>" — when session_start carries a
 *  resumedFrom, the boundary entry tags the predecessor session id
 *  (truncated to 12 chars for log-line economy). */
export const tagResumedFrom = (sessionId: string): string =>
  `resumed-from:${sessionId.slice(0, 12)}`;

/** "reason:<X>" — session_end entries carry the SDK-supplied close
 *  reason (idle | compaction | shutdown | restart | …). */
export const tagSessionReason = (reason: string): string =>
  `reason:${reason}`;

// ─── known-set helpers ─────────────────────────────────────────────────

/** All static (non-parametric) tags this module exports. The set form
 *  is exported so a dashboard can lint operator-supplied filter
 *  strings against the known taxonomy. */
export const KNOWN_STATIC_TAGS: ReadonlySet<string> = new Set([
  TAG_SESSION_START,
  TAG_SESSION_END,
  TAG_COMPACTION,
  TAG_SUBAGENT,
  TAG_SPAWNED_SUBAGENT,
  TAG_SUBAGENT_REFUSED,
  TAG_LOOP_GUARD,
  TAG_OPERATOR_ACTION,
  TAG_FORGET,
  TAG_DESTRUCTIVE,
  TAG_AUTO,
  TAG_AGENT_END,
  TAG_WITH_TOOLS,
  TAG_TOOL_RESULT,
  TAG_THROTTLED,
]);

/** True when `tag` is either a known static tag or a recognized
 *  parametric prefix. Used by the dashboard's filter-input linter. */
export function isKnownTag(tag: string): boolean {
  if (KNOWN_STATIC_TAGS.has(tag)) return true;
  return (
    tag.startsWith("from-subagent:") ||
    tag.startsWith("resumed-from:") ||
    tag.startsWith("reason:")
  );
}
