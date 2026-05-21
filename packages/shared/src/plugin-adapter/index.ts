/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Plugin adapter — wires the vendored Celiums Memory engine to the
// OpenClaw plugin SDK. After the doctrine A1 split this file is just
// the orchestrator: it builds the shared PluginContext once and calls
// each wiring/* and hooks/* module in deterministic order.
//
// The order below mirrors the legacy monolith's registration sequence
// because some host registries log "X of N tools" or insert into
// cache-stable arrays — keeping the visible order constant avoids
// invalidating prefix caches downstream.

import { definePluginEntry, type OpenClawPluginApi } from "../api.js";
import { parseConfig, type CognitionConfig } from "../config-schema/index.js";
import { buildPluginContext, type EditionOptions } from "./context.js";
import { wireCompaction } from "./hooks/compaction.js";
import { wireSubagentHooks } from "./hooks/subagent.js";
import { wireSessionHooks } from "./hooks/session.js";
import { wireOperatorActions, wireMemoryPromptSupplement } from "./wiring/operator.js";
import { wireTools } from "./wiring/tools.js";
import { wirePromptBuild } from "./hooks/prompt-build.js";
import { wireAutoCapture, wireAutoJournal } from "./hooks/agent-end.js";
import { wireEthicsHooks } from "./hooks/ethics.js";
import { wireSecurityAuditCollector } from "./wiring/security-audit.js";
import { wireAutonomyHooks } from "./hooks/autonomy.js";
import { wireService } from "./wiring/service.js";
import { wireHttpRoutes } from "./wiring/http.js";
import { wireCli } from "./wiring/cli.js";

// Re-export public surface so edition packages (packages/hard) and
// other consumers can keep importing from
// `@celiumsai/cognition-shared` without knowing the internal split.
export { type EditionOptions } from "./context.js";
export { type CognitionConfig } from "../config-schema/index.js";

/** Public factory invoked by each edition. */
export function createCognitionPlugin(edition: EditionOptions) {
  return definePluginEntry({
    id: edition.id,
    name: edition.name,
    description: edition.description,
    configSchema: edition.configSchema as never,
    register(api: OpenClawPluginApi) {
      const cfg: CognitionConfig = parseConfig(api.pluginConfig);
      const ctx = buildPluginContext({ api, cfg, edition });

      // ── lifecycle observation + compaction (Fase A) ──
      wireCompaction(ctx);

      // ── subagent lifecycle (Fase B) ──
      wireSubagentHooks(ctx);

      // ── session lifecycle (Fase C) ──
      wireSessionHooks(ctx);

      // ── operator UX surface (Fase D) ──
      wireOperatorActions(ctx);
      wireMemoryPromptSupplement(ctx);

      // ── tool registration + per-tool metadata (Fase E first half) ──
      wireTools(ctx);

      // ── proactive turn-context (auto-recall + identity + briefing) ──
      wirePromptBuild(ctx);

      // ── agent_end ×2 (auto-capture + auto-journal) ──
      wireAutoCapture(ctx);
      wireAutoJournal(ctx);

      // ── ethics gate + security audit collector (Fase E second half) ──
      wireEthicsHooks(ctx);
      wireSecurityAuditCollector(ctx);

      // ── autonomy + channel surface (Fase F) ──
      wireAutonomyHooks(ctx);

      // ── service lifecycle + HTTP routes + CLI ──
      wireService(ctx);
      wireHttpRoutes(ctx);
      wireCli(ctx);

      api.logger.info(`celiums-cognition: ${edition.id} registered`);
    },
  });
}
