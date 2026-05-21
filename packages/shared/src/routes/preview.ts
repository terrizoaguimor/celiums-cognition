/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Diagnostic endpoint: reuses the SAME composer the gateway hooks run
// on every real turn (`buildMemoryPromptSupplement` + the engine's
// `turnContext`) and returns what an LLM would actually see in its
// system prompt for the given user message. Useful for verifying the
// supplement is registered and the dynamic channels are firing.
//
// Not a security-sensitive endpoint, but session-gated anyway —
// the composed text quotes user memories.

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, sendError, parseQuery, type UiRouterContext } from "./utils.js";
import {
  buildMemoryPromptSupplement,
  buildAgentIdentityPreamble,
} from "../prompt-supplement/index.js";
import { CURATED_TOOL_NAMES } from "../tool-curator/index.js";

/** Outer wrapper — catches anything previewPromptImpl throws so the
 *  response is well-formed even on a synchronous error. */
export async function previewPrompt(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    return await previewPromptImpl(ctx, req, res);
  } catch (err) {
    ctx.logger?.warn?.(`preview-prompt threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    if (!res.headersSent) {
      // Doctrine G1: do not surface raw error to wire; the logger above
      // keeps the verbose trace.
      sendError(res, 500, "PREVIEW_ERROR", "preview generation failed");
    }
  }
}

async function previewPromptImpl(
  ctx: UiRouterContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const q = parseQuery(req);
  const msg = q.get("msg")?.trim() || "qué hablamos ayer?";
  const toolsMode = q.get("tools") === "all" ? "all" : "curated";

  const toolSet =
    toolsMode === "all"
      ? new Set([
          "recall", "remember", "forage", "sense",
          "journal_write", "journal_recall", "journal_arc",
          "journal_introspect", "journal_supersede", "journal_verify_chain",
          "journal_dialogue",
          "ethics_trace", "ethics_audit", "ethics_lookup",
          "map_network", "absorb", "bloom", "cultivate",
          "synthesize", "decompose", "construct", "pollinate",
          "turn_context", "turn_after", "compact_checkpoint",
        ])
      : new Set<string>(CURATED_TOOL_NAMES);
  const supplementLines = buildMemoryPromptSupplement(toolSet);

  // Dynamic section — invoke the engine's turn_context composer.
  let prependContext = "";
  let dynamicError: string | null = null;
  const identity = buildAgentIdentityPreamble({
    agentId: "preview-prompt",
    sessionId: "preview-session",
    conversationId: null,
  });
  try {
    const mod = await import("@celiumsai/cognition-engine");
    const turnContext = (mod as { turnContext?: (i: unknown, c: unknown) => Promise<unknown> }).turnContext;
    if (typeof turnContext !== "function") {
      dynamicError = "engine.turnContext not exported by this build";
    } else {
      // NB: the engine's handler reads `args.userMessage` (camelCase)
      // even though the lib/proactive.ts TypeScript declares
      // `user_message`. Pass BOTH to survive either path.
      const tc = (await turnContext(
        { user_message: msg, userMessage: msg, max_chars: 3000 } as never,
        {
          userId: ctx.userId,
          capabilities: {
            opencore: true,
            fleet: !!process.env.CELIUMS_FLEET_API_KEY,
            atlas: !!process.env.CELIUMS_ATLAS_API_KEY,
            ai: !!process.env.CELIUMS_LLM_API_KEY,
          },
          agentId: "preview-prompt",
          sessionId: `preview-${Date.now()}`,
          memoryEngine: ctx.engine,
          pool: ctx.pool,
        },
      )) as { prependContext?: string; context?: string };
      prependContext = String(tc?.prependContext ?? tc?.context ?? "");
    }
  } catch (err) {
    // Doctrine G1: dynamicError surfaces in the JSON response body
    // (preview tool for the operator). Verbose trace into the logger;
    // wire gets a safe class name only.
    ctx.logger?.warn?.(
      `preview-prompt dynamic step failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    dynamicError = "turn_context unavailable";
  }

  const staticText = supplementLines.join("\n");
  const composed = [identity, prependContext, staticText]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  sendJson(res, 200, {
    user_message: msg,
    tools_mode: toolsMode,
    identity_preamble: identity,
    static_supplement: {
      lines: supplementLines,
      total_chars: staticText.length,
    },
    dynamic_turn_context: {
      prependContext,
      total_chars: prependContext.length,
      error: dynamicError,
    },
    composed: {
      text: composed,
      total_chars: composed.length,
    },
  });
}
