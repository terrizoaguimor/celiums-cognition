/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Compaction provider — the plugin's contribution to OpenClaw's
// context-window compaction. When the gateway hits the LLM context
// limit, it asks every registered CompactionProvider for a summary
// and uses the operator's preferred one to replace the older messages.
//
// Our provider does three things in one pass:
//   1. Persists high-information facts from the soon-to-be-compacted
//      messages as `memories` so they survive the context loss.
//   2. Writes an `arc` journal entry on the agent's chain tagged
//      ["compaction","auto"] so the audit shows when context was
//      condensed and what was preserved.
//   3. Returns a structured summary string that replaces the dropped
//      messages — readable enough that the next agent turn can pick
//      up the thread.
//
// Contract verified against OpenClaw 2026.5.19-beta.1
// (CompactionProvider in dist/types-BsgRSTcu2.d.ts).

import {
  journalWrite,
  type MemoryEngineWithStore,
  type JournalEntryType,
} from "@celiumsai/cognition-engine";

/** OpenClaw SDK signature — kept local so we don't import from the
 *  plugin-sdk path the rest of the adapter avoids. Mirrors
 *  `dist/types-BsgRSTcu2.d.ts:CompactionProvider`. */
export interface CompactionProvider {
  id: string;
  label: string;
  summarize(params: {
    messages: unknown[];
    signal?: AbortSignal;
    compressionRatio?: number;
    customInstructions?: string;
    summarizationInstructions?: {
      identifierPolicy?: "strict" | "off" | "custom";
      identifierInstructions?: string;
    };
    previousSummary?: string;
  }): Promise<string>;
}

interface PoolLike {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

interface Logger {
  info?: (m: string) => void;
  warn?: (m: string) => void;
}

export interface CompactionProviderDeps {
  getEngine: () => Promise<MemoryEngineWithStore>;
  extractPool: (engine: MemoryEngineWithStore) => PoolLike | undefined;
  userId: string;
  agentId: string;
  logger: Logger;
}

/** Cap on how much text we feed the persist/summary path per turn.
 *  Compaction is opportunistic — the messages array may be huge, but
 *  we only care about the slice that would actually be lost. */
const MAX_MESSAGES_TO_CONSIDER = 200;

/** Best-effort text extraction from one message. Handles Anthropic
 *  content blocks ({type:"text",text}) and OpenAI-style string content. */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      if ("text" in p && typeof p.text === "string") return p.text;
      return "";
    })
    .join(" ")
    .trim();
}

interface ExtractedFact {
  role: "user" | "assistant";
  text: string;
  toolCallCount: number;
  /** True when the message looks worth persisting as a memory
   *  (user statement of preference / decision / long content). */
  worthPersisting: boolean;
}

/** Walk the message array, pull out the meaningful content, classify
 *  what's worth turning into a durable memory. Deterministic, no LLM. */
function extractFacts(messages: unknown[]): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  if (!Array.isArray(messages)) return facts;
  const slice = messages.slice(-MAX_MESSAGES_TO_CONSIDER);
  for (const msg of slice) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
    if (!role) continue;
    const text = extractText(m.content);
    if (!text) continue;
    // Tool-call count for this message (Anthropic content blocks or
    // OpenAI `tool_calls` array on the message).
    let toolCallCount = 0;
    if (Array.isArray(m.tool_calls)) toolCallCount += m.tool_calls.length;
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use") {
          toolCallCount += 1;
        }
      }
    }
    // Persistence heuristic: user messages over 80 chars or any
    // assistant message that triggered ≥ 2 tool calls (= a "decision"
    // turn). Avoids saving "ok"/"thanks"/short acks.
    const worthPersisting =
      (role === "user" && text.length >= 80) ||
      (role === "assistant" && toolCallCount >= 2);
    facts.push({ role, text, toolCallCount, worthPersisting });
  }
  return facts;
}

/** Convert the extracted facts + previousSummary into the structured
 *  text we return to OpenClaw. Honest and deterministic — the next
 *  agent turn can read this and pick up context without us having
 *  to call an LLM. The agent's own prompt supplement already tells
 *  it that compaction summaries are condensed, not lossless. */
function buildSummary(params: {
  facts: ExtractedFact[];
  previousSummary?: string;
  compressionRatio?: number;
  persisted: { id: string; snippet: string }[];
}): string {
  const { facts, previousSummary, compressionRatio, persisted } = params;
  const userTurns = facts.filter((f) => f.role === "user");
  const assistantTurns = facts.filter((f) => f.role === "assistant");
  const decisionTurns = assistantTurns.filter((f) => f.toolCallCount >= 2);

  const lines: string[] = [];
  lines.push(`[Compaction by Celiums Cognition · ${facts.length} messages condensed${
    compressionRatio ? ` · ratio ${compressionRatio.toFixed(2)}` : ""
  }]`);
  lines.push("");
  if (previousSummary) {
    lines.push("## Carried-over summary (prior compaction round)");
    lines.push(previousSummary.slice(0, 1500));
    lines.push("");
  }
  lines.push("## Recent user thread");
  if (userTurns.length === 0) {
    lines.push("(no user messages in window)");
  } else {
    for (const u of userTurns.slice(-6)) {
      lines.push(`- ${u.text.slice(0, 220)}${u.text.length > 220 ? "…" : ""}`);
    }
  }
  lines.push("");
  lines.push("## Agent decisions (≥2 tool calls)");
  if (decisionTurns.length === 0) {
    lines.push("(no decision-class turns in window)");
  } else {
    for (const d of decisionTurns.slice(-6)) {
      lines.push(`- ${d.text.slice(0, 220)}${d.text.length > 220 ? "…" : ""}  [${d.toolCallCount} tool calls]`);
    }
  }
  lines.push("");
  if (persisted.length > 0) {
    lines.push("## Persistent memories created during this compaction");
    for (const p of persisted) {
      lines.push(`- \`${p.id.slice(0, 8)}…\` — ${p.snippet}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "What lives on: the operator's memory bank holds the high-importance items. " +
      "Use `recall(query)` to pull back specific topics. The journal carries an `arc` " +
      "entry for this compaction; `journal_recall` can read it.",
  );
  return lines.join("\n");
}

/** Build a CompactionProvider bound to the running plugin's engine.
 *  Side effects (memory persistence + journal entry) are best-effort
 *  — a failure to write the journal must not prevent OpenClaw from
 *  getting its summary string back. */
export function makeCeliumsCompactionProvider(
  deps: CompactionProviderDeps,
): CompactionProvider {
  return {
    id: "celiums-cognition",
    label: "Celiums Cognition — persistent emotional memory",
    async summarize({ messages, compressionRatio, previousSummary, signal }) {
      const startedAt = Date.now();
      const facts = extractFacts(messages);
      const toPersist = facts.filter((f) => f.worthPersisting);

      // (1) Persist the worth-saving items as memories. Best-effort —
      // if the engine isn't ready or store rejects, we still produce
      // a summary. `engine.store` does its own embedding + Qdrant write.
      const persisted: { id: string; snippet: string }[] = [];
      if (toPersist.length > 0) {
        try {
          const engine = await deps.getEngine();
          for (const f of toPersist) {
            if (signal?.aborted) break;
            try {
              const r = (await engine.store([
                { content: f.text, userId: deps.userId, importance: 0.7 } as never,
              ])) as Array<{ id: string } | undefined> | undefined;
              const id =
                Array.isArray(r) && r[0] && typeof r[0].id === "string"
                  ? r[0].id
                  : "unknown";
              persisted.push({
                id,
                snippet: f.text.slice(0, 140) + (f.text.length > 140 ? "…" : ""),
              });
            } catch (err) {
              deps.logger.warn?.(
                `celiums-cognition: compaction memory persist failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        } catch (err) {
          deps.logger.warn?.(
            `celiums-cognition: compaction engine unavailable for persist: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // (2) Build the summary text the gateway will use to replace the
      // older messages.
      const summary = buildSummary({
        facts,
        previousSummary,
        compressionRatio,
        persisted,
      });

      // (3) Write a journal arc entry on the agent's chain so the
      // audit shows when context was condensed. Don't block on this.
      try {
        const engine = await deps.getEngine();
        const pool = deps.extractPool(engine);
        if (pool && !signal?.aborted) {
          const entryType: JournalEntryType = "arc";
          await journalWrite(
            {
              entry_type: entryType,
              content:
                `Context compaction triggered (~${facts.length} messages reviewed). ` +
                `Persisted ${persisted.length} memories. ` +
                `User turns: ${facts.filter((f) => f.role === "user").length}, ` +
                `agent decisions: ${facts.filter((f) => f.role === "assistant" && f.toolCallCount >= 2).length}.`,
              valence: 0,
              valence_reason: "automatic compaction summary",
              tags: ["compaction", "auto"],
              visibility: "self",
              agent_id: deps.agentId,
            },
            {
              userId: deps.userId,
              capabilities: { opencore: true, fleet: false, atlas: false, ai: false },
              agentId: deps.agentId,
              pool,
            } as never,
          );
        }
      } catch (err) {
        deps.logger.warn?.(
          `celiums-cognition: compaction journal entry failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const ms = Date.now() - startedAt;
      deps.logger.info?.(
        `celiums-cognition: compaction summarize · ${facts.length} msgs · ${persisted.length} persisted · ${ms}ms`,
      );
      return summary;
    },
  };
}
