/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Session lifecycle — wires OpenClaw's `session_start` / `session_end`
// hooks into the journal so each conversation gets explicit boundary
// entries: a reflection at open, an arc at close with deterministic
// counts and reason.
//
// Doctrine citations (docs/celiums-cognition-doctrine.md):
//   - P1: compose by pure functions; sections that don't apply return null
//   - M4: truncated payloads embed how to retrieve more
//   - G1: hooks return typed results; failures degrade to log, not crash
//   - I5: in-memory state has a cleanup path (sweep on TTL, clear on stop)
//   - L2: state per iteration is immutable — readers get a copy, never the live map
//
// Verified against OpenClaw 2026.5.19-beta.1 SDK shapes (see sdk-contracts
// SESSION_START_EVENT / SESSION_END_EVENT). Cycle of operations:
//
//   session_start → rememberSessionStart() + emit `reflection` journal
//   session_end   → consumeSessionEnd() + composeSessionEndSummary() +
//                    emit `arc` journal tagged [session-end, reason:<X>]

import { journalWrite, type JournalEntryType } from "@celiumsai/cognition-engine";

// ─── config ────────────────────────────────────────────────────────────

export interface SessionConfig {
  /** Cap on `agent_journal` rows scanned to build the end-of-session summary.
   *  Beyond this, the summary cites the cap and points the reader at
   *  `journal_recall` to inspect the rest (doctrine M4). */
  endSummaryScanLimit: number;
  /** Cap on the summary string length (chars). Hard cap on what gets
   *  written to a single journal entry; longer content is truncated
   *  with a recovery note. */
  summaryMaxChars: number;
  /** TTL for the in-memory openSessions tracker. A session that never
   *  receives `session_end` (gateway SIGKILL, panic) is evicted after
   *  this window so the map cannot grow unbounded. */
  openSessionTtlMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  endSummaryScanLimit: 100,
  summaryMaxChars: 1500,
  openSessionTtlMs: 24 * 60 * 60 * 1000, // 24h
};

// ─── in-memory open-session tracker ────────────────────────────────────

interface OpenSessionEntry {
  startedAt: number;
  agentId: string;
  resumedFrom?: string;
  conversationId?: string;
}

const openSessions = new Map<string, OpenSessionEntry>();
let sweepTimer: ReturnType<typeof setInterval> | undefined;

function startSweeper(ttlMs: number): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - ttlMs;
    for (const [sid, entry] of openSessions) {
      if (entry.startedAt < cutoff) openSessions.delete(sid);
    }
  }, Math.min(10 * 60 * 1000, ttlMs / 6)); // every 10min or 6× per TTL
  // Allow process to exit while we're idle.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

/** Test/teardown hook. Stops the sweep timer and clears the map. */
export function _resetSessionTracker(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
  openSessions.clear();
}

export function rememberSessionStart(
  sessionId: string,
  agentId: string,
  resumedFrom: string | undefined,
  conversationId: string | undefined,
  cfg: SessionConfig,
): void {
  startSweeper(cfg.openSessionTtlMs);
  openSessions.set(sessionId, {
    startedAt: Date.now(),
    agentId,
    resumedFrom,
    conversationId,
  });
}

/** Atomically read and remove the open-session record. Returns undefined
 *  when no matching start was observed (e.g. plugin started mid-session
 *  or the open entry expired). Callers compute a best-effort duration
 *  from `event.durationMs` instead. */
export function consumeSessionEnd(
  sessionId: string,
): OpenSessionEntry | undefined {
  const entry = openSessions.get(sessionId);
  if (entry) openSessions.delete(sessionId);
  return entry;
}

// ─── pool abstraction ──────────────────────────────────────────────────

export interface PoolLike {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

// ─── summary builder ───────────────────────────────────────────────────

/** Output shape of composeSessionEndSummary. The text itself is what
 *  lands in the journal; metadata is exposed for callers that want to
 *  log structured fields alongside. */
export interface EndSummary {
  text: string;
  scanned: number;
  truncated: boolean;
}

interface ComposeArgs {
  pool: PoolLike;
  sessionId: string;
  agentId: string;
  reason: string;
  durationMs: number | undefined;
  messageCount: number;
  startedAt: number | undefined;
  resumedFrom: string | undefined;
  nextSessionId: string | undefined;
  cfg: SessionConfig;
}

/** Build the deterministic end-of-session summary. No LLM call — the
 *  shape is fixed so future readers (operator dashboard, the agent
 *  itself on next session) can parse predictably.
 *
 *  Citations: M4 (truncation is self-explanatory), P5 (output format is
 *  documented in code via this function's contract). */
export async function composeSessionEndSummary(
  args: ComposeArgs,
): Promise<EndSummary> {
  const { pool, sessionId, agentId, reason, durationMs, messageCount,
          startedAt, resumedFrom, nextSessionId, cfg } = args;

  // Compute duration: prefer the SDK-supplied value (authoritative);
  // fall back to our own tracker when the SDK omitted it.
  let durationStr = "?";
  if (typeof durationMs === "number" && durationMs >= 0) {
    durationStr = humanizeMs(durationMs);
  } else if (typeof startedAt === "number") {
    durationStr = humanizeMs(Date.now() - startedAt);
  }

  // Pull this session's journal entries (excluding the session-end
  // entry we're about to write — there is no race because we write
  // AFTER this query).
  let entryRows: Array<{ entry_type: string }> = [];
  let lineageRows: Array<{ outcome: string | null }> = [];
  let scanned = 0;
  let truncated = false;
  try {
    const r = await pool.query(
      `SELECT entry_type
         FROM agent_journal
        WHERE conversation_id = $1::uuid
          AND agent_id = $2
        ORDER BY written_at ASC
        LIMIT $3`,
      [sessionId, agentId, cfg.endSummaryScanLimit + 1],
    );
    entryRows = (r.rows as Array<{ entry_type: string }>).slice(0, cfg.endSummaryScanLimit);
    scanned = entryRows.length;
    truncated = r.rows.length > cfg.endSummaryScanLimit;
  } catch {
    // Schema mismatch or transient DB error — fall through with zero
    // scanned. The summary still gets written; it just lacks
    // entry counts. Doctrine G1: degrade visibly.
  }
  try {
    const r = await pool.query(
      `SELECT end_outcome AS outcome
         FROM agent_lineage
        WHERE conversation_id = $1::uuid
          AND parent_agent_id = $2`,
      [sessionId, agentId],
    );
    lineageRows = r.rows as Array<{ outcome: string | null }>;
  } catch {
    // agent_lineage missing on pre-014 gateways — skip.
  }

  const typeCounts = countByEntryType(entryRows);
  const subagentSummary = summarizeSubagents(lineageRows);

  const lines: string[] = [];
  lines.push(
    `Session closed (reason: ${reason}, duration: ${durationStr}, ` +
    `messages: ${messageCount}).`,
  );
  if (resumedFrom) {
    lines.push(`Continued from session ${shortId(resumedFrom)}.`);
  }
  if (nextSessionId) {
    lines.push(`Next session: ${shortId(nextSessionId)}.`);
  }
  if (scanned > 0) {
    const typesStr = Object.entries(typeCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    lines.push(`Journal: ${scanned} entries (${typesStr}).`);
  } else {
    lines.push(`Journal: no entries written this session.`);
  }
  if (subagentSummary) lines.push(subagentSummary);
  if (truncated) {
    // Doctrine M4: tell the reader what got cut and how to recover.
    lines.push(
      `Entry scan capped at ${cfg.endSummaryScanLimit}. Use ` +
      `\`journal_recall conversation_id=${shortId(sessionId)}\` ` +
      `to inspect the full chain.`,
    );
  }

  let text = lines.join("\n");
  if (text.length > cfg.summaryMaxChars) {
    const head = text.slice(0, cfg.summaryMaxChars - 80);
    text = `${head}\n[Summary truncated to ${cfg.summaryMaxChars} chars. ` +
           `Full counts available via \`journal_recall\`.]`;
    truncated = true;
  }

  return { text, scanned, truncated };
}

function countByEntryType(
  rows: Array<{ entry_type: string }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = r.entry_type || "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function summarizeSubagents(rows: Array<{ outcome: string | null }>): string | null {
  if (rows.length === 0) return null;
  const counts = { ok: 0, error: 0, other: 0 };
  for (const r of rows) {
    if (r.outcome === "ok") counts.ok++;
    else if (r.outcome === "error") counts.error++;
    else counts.other++;
  }
  const parts: string[] = [];
  if (counts.ok) parts.push(`${counts.ok} ok`);
  if (counts.error) parts.push(`${counts.error} error`);
  if (counts.other) parts.push(`${counts.other} other`);
  return `Spawned subagents: ${rows.length} (${parts.join(", ")}).`;
}

function humanizeMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

// ─── journal emission helpers ──────────────────────────────────────────

export interface EmitArgs {
  pool: PoolLike;
  userId: string;
  agentId: string;
  entryType: JournalEntryType;
  content: string;
  valence: number;
  valenceReason: string;
  tags: string[];
  conversationId?: string;
}

/** Thin wrapper around journalWrite with the capabilities envelope the
 *  engine expects. Used by the session_start and session_end handlers
 *  in plugin-adapter/index.ts. Mirrors `emitJournal` in subagent.ts —
 *  duplicated intentionally to keep the module surfaces independent
 *  (P1: each adapter file owns its own composition). */
export async function emitSessionJournal(args: EmitArgs): Promise<void> {
  await journalWrite(
    {
      entry_type: args.entryType,
      content: args.content,
      valence: args.valence,
      valence_reason: args.valenceReason,
      tags: args.tags,
      visibility: "self",
      agent_id: args.agentId,
    },
    {
      userId: args.userId,
      capabilities: { opencore: true, fleet: false, atlas: false, ai: false },
      agentId: args.agentId,
      pool: args.pool as never,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
    } as never,
  );
}
