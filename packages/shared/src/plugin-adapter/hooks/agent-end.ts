/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// agent_end hooks — auto-capture (turn → memory) + auto-journal (turn
// → agent_journal entry).
//
// The agent_end event fires twice in our wiring because the two
// concerns are independent and each must be feature-gateable via cfg.
// Per-agent flood guard (audit S-017) lives on PluginContext as
// `autoJournalShouldFire`.

import {
  withShapeValidation, AGENT_END_EVENT,
} from "../../sdk-contracts.js";
import { journalWrite, type JournalEntryType } from "@celiumsai/cognition-engine";
import { rememberParentForThread, threadKey } from "../subagent.js";
import { resolveAgentId } from "../shared-types.js";
import {
  TAG_AUTO, TAG_AGENT_END, TAG_WITH_TOOLS,
} from "../journal-tags.js";
import { latestUserText } from "./prompt-build.js";
import type { PluginContext } from "../context.js";

function latestAssistantText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (m?.role === "assistant") {
      const c = m.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        const text = c.map((b) => (b && typeof b === "object" && (b as { text?: string }).text) || "").join(" ").trim();
        if (text) return text;
      }
    }
  }
  return undefined;
}

function countToolCalls(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const m of messages) {
    const r = (m as { role?: string })?.role;
    if (r !== "assistant" && r !== "tool") continue;
    const c = (m as { content?: unknown }).content;
    if (Array.isArray(c)) {
      for (const block of c) {
        if (block && typeof block === "object" && (block as { type?: string }).type === "tool_use") n++;
      }
    }
    if (Array.isArray((m as { tool_calls?: unknown }).tool_calls)) {
      n += ((m as { tool_calls: unknown[] }).tool_calls.length);
    }
  }
  return n;
}

export function wireAutoCapture(ctx: PluginContext): void {
  const { api, cfg, userId, getEngine, gateReady } = ctx;
  if (!cfg.autoCapture.enabled) return;

  api.on(
    "agent_end",
    withShapeValidation(
      AGENT_END_EVENT,
      async (
        event: { success?: boolean; messages?: unknown; agentId?: string },
        hookCtx: { sessionKey?: string; sessionId?: string; agentId?: string; conversationId?: string; requester?: { channel?: string; accountId?: string; to?: string; threadId?: string | number } },
      ) => {
        if (!gateReady()) return undefined;
        // Remember this agent as the parent-of-record for its current
        // thread — the next subagent_spawning fired from the same
        // thread can identify us as the parent.
        const tKey = threadKey(hookCtx?.requester, hookCtx?.sessionKey);
        if (tKey) {
          rememberParentForThread(
            tKey,
            resolveAgentId([hookCtx?.agentId, event.agentId], cfg.agentId),
            hookCtx?.sessionId,
            hookCtx?.conversationId,
          );
        }
        if (!event.success) return;
        const text = latestUserText(event.messages);
        if (!text) return;
        try {
          const engine = await getEngine();
          await engine.store([{ content: text, userId } as never]);
        } catch (err) {
          api.logger.warn?.(`celiums-cognition: auto-capture failed: ${String(err)}`);
        }
        return undefined;
      },
      { warn: (m) => api.logger.warn?.(m) },
    ),
  );
}

export function wireAutoJournal(ctx: PluginContext): void {
  const { api, cfg, userId, getEngine, extractEnginePool, gateReady, autoJournalShouldFire } = ctx;
  if (!cfg.journal.enabled || !cfg.journal.autoWrite.enabled) return;

  api.on(
    "agent_end",
    withShapeValidation(
      AGENT_END_EVENT,
      async (
        event: { success?: boolean; messages?: unknown; prompt?: string; agentId?: string },
        hookCtx: { sessionKey?: string; sessionId?: string; agentId?: string },
      ) => {
        if (!gateReady()) return undefined;
        const userText = latestUserText(event.messages) ?? event.prompt ?? "";
        const assistantText = latestAssistantText(event.messages) ?? "";
        const toolCalls = countToolCalls(event.messages);
        if (userText.trim().length < cfg.journal.autoWrite.minTurnLength) return;
        if (assistantText.trim().length < 20) return;

        const journalAgentId = resolveAgentId([hookCtx?.agentId, event.agentId], cfg.agentId);
        if (!autoJournalShouldFire(journalAgentId)) {
          api.logger.warn?.(
            `celiums-cognition: auto-journal throttled for agent=${journalAgentId}`,
          );
          return;
        }

        // entry_type heuristic
        let entryType: JournalEntryType = "reflection";
        if (event.success === false) entryType = "doubt";
        else if (toolCalls >= 2) entryType = "decision";
        else if (assistantText.length > userText.length * 4) entryType = "reflection";

        const valence = event.success === false ? -0.3 : 0.2;
        const content = [
          `User: ${userText.slice(0, 600)}${userText.length > 600 ? "…" : ""}`,
          `Agent (${toolCalls} tool call${toolCalls === 1 ? "" : "s"}): ${assistantText.slice(0, 800)}${assistantText.length > 800 ? "…" : ""}`,
        ].join("\n\n");

        try {
          const engine = await getEngine();
          const pool = extractEnginePool(engine);
          if (!pool) return;
          await journalWrite(
            {
              entry_type: entryType,
              content,
              valence,
              valence_reason: event.success === false ? "agent turn ended with success=false" : "agent turn closed",
              tags: [TAG_AUTO, TAG_AGENT_END, ...(toolCalls > 0 ? [TAG_WITH_TOOLS] : [])],
              visibility: "self",
              conversation_id: hookCtx.sessionId ?? hookCtx.sessionKey,
              agent_id: resolveAgentId([hookCtx.agentId, event.agentId], cfg.agentId),
            },
            {
              userId,
              capabilities: { opencore: true as const, fleet: false, atlas: false, ai: false },
              agentId: resolveAgentId([hookCtx.agentId, event.agentId], cfg.agentId),
              sessionId: hookCtx.sessionId ?? hookCtx.sessionKey,
              pool,
            } as never,
          );
        } catch (err) {
          api.logger.warn?.(
            `celiums-cognition: auto-journal failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return undefined;
      },
      { warn: (m) => api.logger.warn?.(m) },
    ),
  );
}
