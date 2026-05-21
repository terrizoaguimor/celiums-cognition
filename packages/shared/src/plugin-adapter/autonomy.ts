/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Autonomy + channel surface — heartbeat contributions, tool-result
// observability, and an inbound mailbox bridge that lets external
// channels (any other plugin that owns a Telegram/Slack/email adapter)
// queue content into the next agent turn without pushing state
// directly into the cognition store or UI.
//
// Doctrine citations (docs/celiums-cognition-doctrine.md):
//   - L1: async control flow with no shared mutable flags. We use
//         AbortSignal-aware awaits and let the caller cancel.
//   - L3: recovery is monotonic — heartbeat contribution either
//         returns the snapshot or returns undefined; no retry storm.
//   - G2: anti-confabulation. The heartbeat snapshot describes STATE,
//         never fabricates a result for an async fork.
//   - G4: channel bridges as mailboxes. Inbound channels enqueue
//         injections; the next agent turn picks them up. Nothing
//         flows directly into UI or shared state.
//   - I5: throttled writes during tool floods so the journal is not
//         flooded by a long-running loop's tool chatter.
//
// Verified SDK shapes (openclaw@2026.5.19-beta.1):
//   PluginHeartbeatPromptContributionEvent  (hook-types:270-274)
//   PluginHeartbeatPromptContributionResult (hook-types:275-278)
//   PluginHookToolResultPersistEvent         (hook-types:563-568)
//   PluginHookToolResultPersistResult        (hook-types:569-571)
//   PluginNextTurnInjection                  (hook-types:241-248)
//   PluginNextTurnInjectionEnqueueResult     (hook-types:256-260)

import { type MemoryEngineWithStore, journalWrite } from "@celiumsai/cognition-engine";
import { TAG_AUTO, TAG_TOOL_RESULT, TAG_THROTTLED } from "./journal-tags.js";

// ─── pool + deps abstraction ───────────────────────────────────────────

export type { PoolLike } from "./shared-types.js";
import type { PoolLike, Logger } from "./shared-types.js";

export interface AutonomyDeps {
  getEngine: () => Promise<MemoryEngineWithStore>;
  extractPool: (engine: MemoryEngineWithStore) => PoolLike | undefined;
  userId: string;
  agentId: string;
  ethicsMode: string;
  logger?: Logger;
}

// ─── heartbeat snapshot ────────────────────────────────────────────────

/** Compose the prependContext string for a heartbeat tick. Strict G2:
 *  no inferences, no predictions — every line cites a concrete state
 *  we can read from pg right now. Keeps the contribution under ~600
 *  chars so heartbeats do not bloat each prompt. */
export async function composeHeartbeatSnapshot(
  deps: AutonomyDeps,
): Promise<string | null> {
  let pool: PoolLike | undefined;
  try {
    const engine = await deps.getEngine();
    pool = deps.extractPool(engine);
  } catch {
    return null;
  }
  if (!pool) return null;

  let journalHead:
    | { id: string; hash: string; written_at: string }
    | null = null;
  let memoryCount = 0;
  let openSubagents = 0;
  try {
    const r = await pool.query(
      `SELECT id, hash, written_at
         FROM agent_journal
        WHERE agent_id = $1
        ORDER BY written_at DESC
        LIMIT 1`,
      [deps.agentId],
    );
    if (r.rows[0]) {
      const w = r.rows[0].written_at;
      journalHead = {
        id: String(r.rows[0].id),
        hash: String(r.rows[0].hash),
        written_at: w instanceof Date ? w.toISOString() : String(w ?? ""),
      };
    }
  } catch {
    // journal table missing — degrade silently.
  }
  try {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM memories WHERE user_id = $1`,
      [deps.userId],
    );
    memoryCount = Number(r.rows[0]?.n ?? 0);
  } catch {
    // memories table missing — degrade silently.
  }
  try {
    const r = await pool.query(
      `SELECT count(*)::int AS n
         FROM agent_lineage
        WHERE parent_agent_id = $1
          AND ended_at IS NULL`,
      [deps.agentId],
    );
    openSubagents = Number(r.rows[0]?.n ?? 0);
  } catch {
    // agent_lineage missing on pre-014 gateways.
  }

  const lines: string[] = [
    "## Cognition heartbeat",
    `Memory count: ${memoryCount}.`,
    `Open subagents: ${openSubagents}.`,
    `Ethics mode: ${deps.ethicsMode}.`,
  ];
  if (journalHead) {
    lines.push(
      `Last journal entry: \`${journalHead.id.slice(0, 8)}…\` ` +
      `(hash \`${journalHead.hash.slice(0, 8)}…\`) at ${journalHead.written_at}.`,
    );
  } else {
    lines.push(`Last journal entry: none yet this session.`);
  }
  // G2 reminder baked into the snapshot — if the agent is in a
  // proactive loop, the snapshot itself reminds it not to fabricate
  // results for async work.
  lines.push(
    `Reminder: this snapshot is state, not result. If a fork is in ` +
    `flight, wait for its notification; do not narrate a guess.`,
  );
  return lines.join("\n");
}

// ─── tool-result persistence — throttled auto-journal ─────────────────

/** Sliding-window counter so a tool-call storm in a long loop does not
 *  flood the journal. Keeps the LAST N timestamps per agentId and only
 *  emits a journal entry when the rate stays under threshold; otherwise
 *  rolls the events into a single periodic summary. I5 in practice. */
interface ToolWindow {
  events: number[];
  lastSummaryAt: number;
  suppressedCount: number;
}
const toolWindows = new Map<string, ToolWindow>();
const WINDOW_MS = 60_000;
const MAX_EVENTS_IN_WINDOW = 30;
const SUMMARY_INTERVAL_MS = 5 * 60_000;

interface ToolResultRecord {
  toolName?: string;
  toolCallId?: string;
  isSynthetic?: boolean;
}

/** Decide what to write (if anything) when a tool result is persisted.
 *  Returns the journal entry payload, or null when we are inside a
 *  flood window and the event was suppressed (a periodic summary will
 *  flush the suppression count). */
export function decideToolResultJournal(
  agentId: string,
  event: ToolResultRecord,
): { kind: "individual"; toolName: string; toolCallId?: string }
  | { kind: "summary"; suppressedCount: number; toolName: string }
  | null {
  if (event.isSynthetic) return null;
  const now = Date.now();
  let w = toolWindows.get(agentId);
  if (!w) {
    w = { events: [], lastSummaryAt: now, suppressedCount: 0 };
    toolWindows.set(agentId, w);
  }
  // Drop events outside the window.
  w.events = w.events.filter((t) => now - t < WINDOW_MS);
  w.events.push(now);
  const toolName = event.toolName ?? "(unnamed)";

  if (w.events.length <= MAX_EVENTS_IN_WINDOW) {
    return {
      kind: "individual",
      toolName,
      ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    };
  }
  // Over threshold — suppress this event; emit a summary if the
  // interval has elapsed since the last summary write.
  w.suppressedCount++;
  if (now - w.lastSummaryAt >= SUMMARY_INTERVAL_MS) {
    const count = w.suppressedCount;
    w.lastSummaryAt = now;
    w.suppressedCount = 0;
    return { kind: "summary", suppressedCount: count, toolName };
  }
  return null;
}

/** Test/teardown hook. */
export function _resetToolWindows(): void {
  toolWindows.clear();
}

/** Write a tool-result journal entry (best-effort). Called by the
 *  plugin-adapter when decideToolResultJournal returned non-null. */
export async function writeToolResultJournal(
  deps: AutonomyDeps,
  decision: NonNullable<ReturnType<typeof decideToolResultJournal>>,
): Promise<void> {
  let pool: PoolLike | undefined;
  try {
    const engine = await deps.getEngine();
    pool = deps.extractPool(engine);
  } catch {
    return;
  }
  if (!pool) return;
  try {
    if (decision.kind === "individual") {
      await journalWrite(
        {
          entry_type: "reflection",
          content:
            `Tool result persisted: \`${decision.toolName}\`` +
            (decision.toolCallId ? ` (call ${decision.toolCallId.slice(0, 12)})` : "") +
            `.`,
          valence: 0,
          valence_reason: "tool result auto-trace",
          tags: [TAG_AUTO, TAG_TOOL_RESULT, decision.toolName],
          visibility: "self",
          agent_id: deps.agentId,
        },
        {
          userId: deps.userId,
          capabilities: { opencore: true, fleet: false, atlas: false, ai: false },
          agentId: deps.agentId,
          pool: pool as never,
        } as never,
      );
    } else {
      await journalWrite(
        {
          entry_type: "reflection",
          content:
            `Tool-result flood throttled: ${decision.suppressedCount} ` +
            `additional tool results suppressed in the last 5 minutes ` +
            `(most recent: \`${decision.toolName}\`). ` +
            `Inspect via \`turn_after\` or the dashboard if needed.`,
          valence: -0.05,
          valence_reason: "tool flood summary",
          tags: [TAG_AUTO, TAG_TOOL_RESULT, TAG_THROTTLED],
          visibility: "self",
          agent_id: deps.agentId,
        },
        {
          userId: deps.userId,
          capabilities: { opencore: true, fleet: false, atlas: false, ai: false },
          agentId: deps.agentId,
          pool: pool as never,
        } as never,
      );
    }
  } catch (err) {
    deps.logger?.warn?.(
      `celiums-cognition: tool-result journal write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── inbox mailbox ─────────────────────────────────────────────────────

export interface InboxPayload {
  /** Target session that should pick this up on its next turn. */
  sessionKey: string;
  /** Plain text the agent will see at the top (or bottom) of its
   *  next turn's context. Cap is enforced by the host — keep short. */
  text: string;
  /** When omitted, the host generates one. Useful for client-side
   *  idempotency if the same channel could re-post the same payload. */
  idempotencyKey?: string;
  /** Defaults to "prepend_context" — channel notices typically want
   *  to be the first thing the agent sees on its next turn. */
  placement?: "prepend_context" | "append_context";
  /** Source channel id for audit. Stored in the injection's metadata
   *  so the agent can see WHERE the notice came from. */
  channel?: string;
  /** Optional TTL — when the next turn does not happen within this
   *  window, the injection is dropped. Keeps stale channel notices
   *  from showing up much later out of context. */
  ttlMs?: number;
}

export interface InboxResult {
  ok: boolean;
  id?: string;
  enqueued?: boolean;
  error?: string;
}

/** Enqueue an inbox payload via the gateway's `enqueueNextTurnInjection`
 *  function. Feature-detected; on hosts without the seam, returns
 *  `{ok: false, error: "UNAVAILABLE"}` so the caller can decide whether
 *  to fall back (e.g. write a journal entry tagged ["channel-inbound"]
 *  for offline replay).
 *
 *  The `api.enqueueNextTurnInjection` reference is captured at module
 *  init by the adapter and passed in here so this module stays free of
 *  host-specific imports. */
export type EnqueueNextTurnInjectionFn = (
  injection: {
    sessionKey: string;
    text: string;
    idempotencyKey?: string;
    placement?: "prepend_context" | "append_context";
    ttlMs?: number;
    metadata?: Record<string, unknown>;
  },
) => Promise<{ enqueued: boolean; id: string; sessionKey: string }>;

export async function enqueueInboxInjection(
  enqueue: EnqueueNextTurnInjectionFn,
  payload: InboxPayload,
): Promise<InboxResult> {
  if (!payload.sessionKey || !payload.text) {
    return { ok: false, error: "sessionKey and text are required" };
  }
  try {
    const result = await enqueue({
      sessionKey: payload.sessionKey,
      text: payload.text,
      ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
      placement: payload.placement ?? "prepend_context",
      ...(payload.ttlMs ? { ttlMs: payload.ttlMs } : {}),
      metadata: {
        source: "celiums-cognition.inbox",
        ...(payload.channel ? { channel: payload.channel } : {}),
      },
    });
    return { ok: true, id: result.id, enqueued: result.enqueued };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
