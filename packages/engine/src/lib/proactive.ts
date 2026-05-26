/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 * Originally derived from celiums-memory v2.0
 * (https://github.com/terrizoaguimor/celiums-memory, Apache 2.0)
 */
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Celiums Solutions LLC

/**
 * Proactive library — typed facades over turn_context, turn_after,
 * compact_checkpoint. These are the highest-leverage tools (auto-bootstrap
 * candidate per ADR-008) and the densest in the codebase (1420 LOC across
 * 3 handlers). Bridge for now; refactor any to dedicated lib/* when the
 * profile demands it.
 */

import { bridgeHandler } from './from-handler.js';
import { PROACTIVE_TOOLS } from '../mcp/proactive-tools.js';

const byName = Object.fromEntries(PROACTIVE_TOOLS.map((t) => [t.definition.name, t.handler] as const));

// ─── turn_context ─────────────────────────────────────────────────────
// Audit fix v0.1.2: the handler takes camelCase (userMessage) plus an
// optional conversationId, and returns prependContext + channelsActive +
// tokensUsedChars + suggestionTriggers. Re-typed to match.
export interface TurnContextInput {
  userMessage: string;
  conversationId?: string;
  channels?: string[];
  max_chars?: number;
}
export interface TurnContextOutput {
  prependContext: string;
  channelsActive: string[];
  tokensUsedChars: number;
  suggestionTriggers?: string[];
}
export const turnContext = bridgeHandler<TurnContextInput, TurnContextOutput>(byName['turn_context']);

// ─── turn_after ───────────────────────────────────────────────────────
// Audit fix v0.1.2: the facade originally declared user_message /
// assistant_message and saved_memories / journal_entries / insights, but
// the real tool takes userMessage / agentReply / failed / importance /
// tags and reports captured / capturedId / cultivated / synthesized /
// reasonsSkipped. Re-typed to match the handler.
export interface TurnAfterInput {
  userMessage: string;
  agentReply: string;
  conversationId?: string;
  failed?: boolean;
  importance?: number;
  tags?: string[];
}
export interface TurnAfterOutput {
  captured: boolean;
  capturedId?: string;
  cultivated?: boolean;
  synthesized?: boolean;
  reasonsSkipped?: string[];
}
export const turnAfter = bridgeHandler<TurnAfterInput, TurnAfterOutput>(byName['turn_after']);

// ─── compact_checkpoint ───────────────────────────────────────────────
// Audit fix v0.1.2: the facade originally promised a conversation-summary
// envelope but the handler takes the raw messages array (it scans for the
// structured signal prefix itself), plus an optional customInstructions
// note and agentId override. Re-typed to match.
export interface CompactCheckpointInput {
  messages: Array<{ role: string; content: string }>;
  customInstructions?: string;
  agentId?: string;
}
export interface CompactCheckpointOutput {
  persisted: boolean;
  reason?: string;
  entries?: number;
  arc?: string;
}
export const compactCheckpoint = bridgeHandler<CompactCheckpointInput, CompactCheckpointOutput>(byName['compact_checkpoint']);
