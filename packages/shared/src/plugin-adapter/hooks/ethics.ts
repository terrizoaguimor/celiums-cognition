/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Ethics gate — public hooks (NOT registerTrustedToolPolicy, which is
// bundled-plugin-only).
//
// Doctrine G1: hooks return typed decisions carrying decision, reason,
// source, and category. HookDecisionBlock supports `category`
// (analytics tag) and `metadata` (audit context).
//
// Doctrine G3: rules layered by source. Today the plugin reads from
// cfg.ethics; operator runtime adjustments would route through
// userSettings/projectSettings layers. The `source` field on each
// block decision names the layer that fired, so the operator
// dashboard can show "blocked by project-level rule" vs "blocked by
// hard policy" without re-deriving from the reason string.

import { ethics } from "@celiumsai/cognition-engine";
import { resolveAgentId } from "../shared-types.js";
import type { PluginContext } from "../context.js";

interface GateVerdict {
  block: boolean;
  reason: string;
  category: string;
  source: "engine-default" | "project-config" | "session-override";
  ruleId?: string;
}

export function wireEthicsHooks(ctx: PluginContext): void {
  const { api, cfg } = ctx;
  if (!cfg.ethics.enabled) return;

  const judge = (text: string): GateVerdict => {
    const r = ethics.evaluate(text);
    if (r.passed) {
      return { block: false, reason: "", category: "pass", source: "engine-default" };
    }
    const violations = r.violations ?? [];
    const hard = violations.some((v: { blocked?: boolean }) => v.blocked);
    const block = cfg.ethics.strictMode ? true : hard;
    const categories = violations
      .map((v: { category?: string }) => v.category)
      .filter((c: string | undefined): c is string => Boolean(c));
    const primary = categories[0] ?? "policy-violation";
    const reason = `Celiums ethics: ${categories.join(", ") || "policy violation"}`;
    return {
      block,
      reason,
      category: primary,
      source: cfg.ethics.strictMode && !hard ? "project-config" : "engine-default",
      ruleId: (violations[0] as { ruleId?: string } | undefined)?.ruleId,
    };
  };

  api.on(
    "before_agent_run",
    (event: { prompt?: string }, hookCtx: { agentId?: string; sessionId?: string }) => {
      if (!event.prompt) return undefined;
      const v = judge(event.prompt);
      if (!v.block) return undefined;
      api.logger.info(
        `celiums-cognition: ethics block · before_agent_run · category=${v.category} · source=${v.source} · agent=${resolveAgentId([hookCtx?.agentId], cfg.agentId)}`,
      );
      return {
        outcome: "block" as const,
        reason: v.reason,
        category: v.category,
        metadata: {
          source: v.source,
          surface: "before_agent_run",
          ...(v.ruleId ? { ruleId: v.ruleId } : {}),
        },
      };
    },
  );

  api.on(
    "before_tool_call",
    (event: { toolName?: string; args?: unknown }, hookCtx: { agentId?: string; sessionId?: string }) => {
      const probe = `${event.toolName ?? ""} ${JSON.stringify(event.args ?? {})}`;
      const v = judge(probe);
      if (!v.block) return undefined;
      api.logger.info(
        `celiums-cognition: ethics block · before_tool_call · tool=${event.toolName} · category=${v.category} · source=${v.source} · agent=${resolveAgentId([hookCtx?.agentId], cfg.agentId)}`,
      );
      return {
        block: true as const,
        blockReason: `${v.reason} (source: ${v.source}, category: ${v.category})`,
      };
    },
  );
}
