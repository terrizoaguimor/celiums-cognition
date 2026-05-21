/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Tool metadata — declarative taxonomy + risk profile for every tool
// the plugin registers. Fed to `api.registerToolMetadata()` so the
// operator shell can group tools visually, filter by risk, and surface
// the right confirmation UI for destructive calls.
//
// Doctrine citations (docs/celiums-cognition-doctrine.md):
//   - T1: tool contract amplio; risk defaults fail-closed (medium when
//         the override does not name a lower band explicitly)
//   - U4: high-risk tools surface a typed permission request — this
//         module assigns the risk; the host renders the dialog
//   - G3: rules layered by source — overrides here are project-level
//         (shipped with the plugin); operator runtime config can
//         further restrict via the ethics gate
//
// SDK shape (verified against openclaw@2026.5.19-beta.1 index-BHaNdiKe.d.ts:64-70):
//   PluginToolMetadataRegistration = {
//     toolName: string;
//     displayName?: string;
//     description?: string;
//     risk?: "low" | "medium" | "high";
//     tags?: string[];
//   }

export type ToolRisk = "low" | "medium" | "high";
export type ToolGroup =
  | "memory"
  | "journal"
  | "ethics"
  | "cognitive"
  | "atlas"
  | "research"
  | "write";

export interface ToolMetadata {
  toolName: string;
  displayName?: string;
  description?: string;
  risk: ToolRisk;
  tags: string[];
}

// ─── prefix-based defaults ─────────────────────────────────────────────
// Most tools follow a `<group>_<verb>` naming convention. The prefix
// alone implies the group and a reasonable risk floor.

interface PrefixRule {
  prefix: string;
  group: ToolGroup;
  defaultRisk: ToolRisk;
}

const PREFIX_RULES: readonly PrefixRule[] = [
  { prefix: "journal_", group: "journal", defaultRisk: "low" },
  { prefix: "ethics_", group: "ethics", defaultRisk: "low" },
  { prefix: "memory_", group: "memory", defaultRisk: "medium" },
  { prefix: "research_", group: "research", defaultRisk: "low" },
  { prefix: "write_", group: "write", defaultRisk: "low" },
  { prefix: "atlas_", group: "atlas", defaultRisk: "low" },
  { prefix: "tenant_", group: "memory", defaultRisk: "high" }, // tenant ops are global
];

// ─── exact-name overrides ──────────────────────────────────────────────
// Curated cognitive surface — no group prefix, listed explicitly.
// Destructive variants get bumped above their prefix default.

const EXACT_OVERRIDES: Readonly<Record<string, Partial<ToolMetadata> & { group?: ToolGroup }>> = {
  // Curated cognitive surface
  recall:           { group: "memory",    risk: "low",  tags: ["read"] },
  remember:         { group: "memory",    risk: "medium", tags: ["write"] },
  forage:           { group: "cognitive", risk: "low",  tags: ["read", "semantic-search"] },
  sense:            { group: "cognitive", risk: "low",  tags: ["read", "limbic"] },
  map_network:      { group: "cognitive", risk: "low",  tags: ["read", "graph"] },
  absorb:           { group: "cognitive", risk: "medium", tags: ["write", "ingest"] },
  bloom:            { group: "cognitive", risk: "low",  tags: ["read", "consolidation"] },
  cultivate:        { group: "cognitive", risk: "medium", tags: ["write", "refinement"] },
  synthesize:       { group: "cognitive", risk: "low",  tags: ["read", "summary"] },
  decompose:        { group: "cognitive", risk: "low",  tags: ["read", "analysis"] },
  construct:        { group: "cognitive", risk: "low",  tags: ["read", "synthesis"] },
  pollinate:        { group: "cognitive", risk: "medium", tags: ["write", "cross-pillar"] },
  compact_checkpoint: { group: "memory",  risk: "medium", tags: ["write", "compaction"] },

  // Journal — write variants bumped to medium, secure variants high
  journal_write:          { risk: "medium", tags: ["write"] },
  journal_write_secure:   { risk: "high",   tags: ["write", "secure"] },
  journal_recall_secure:  { risk: "low",    tags: ["read", "secure"] },
  journal_redact_secure:  { risk: "high",   tags: ["destructive", "secure", "audit"] },
  journal_supersede:      { risk: "high",   tags: ["destructive", "audit"] },
  journal_verify_chain:   { risk: "low",    tags: ["read", "integrity"] },

  // Memory — secure variants and any *_delete_secure / *_bulk_delete_secure are HIGH
  memory_recall_secure:       { risk: "low",  tags: ["read", "secure"] },
  memory_remember_secure:     { risk: "medium", tags: ["write", "secure"] },
  memory_update_secure:       { risk: "medium", tags: ["write", "secure"] },
  memory_delete_secure:       { risk: "high", tags: ["destructive", "secure"] },
  memory_bulk_delete_secure:  { risk: "high", tags: ["destructive", "secure", "bulk"] },

  // Tenant — always high (operator-only)
  tenant_delete_secure: { risk: "high", tags: ["destructive", "secure", "tenant"] },
  tenant_export_secure: { risk: "high", tags: ["read", "secure", "export"] },

  // Profile
  profile_publish_secure: { risk: "high", tags: ["write", "secure", "public-surface"] },

  // Ethics
  ethics_audit:   { risk: "low", tags: ["read", "audit"] },
  ethics_lookup:  { risk: "low", tags: ["read"] },
  ethics_trace:   { risk: "low", tags: ["read", "diagnostics"] },

  // Atlas (LLM proxies — `low` reads, but cost is medium)
  atlas_ask:           { risk: "medium", tags: ["llm", "cost"] },
  atlas_chat:          { risk: "medium", tags: ["llm", "cost"] },
  atlas_classify:      { risk: "low", tags: ["llm", "cost"] },
  atlas_recommend:     { risk: "low", tags: ["llm"] },
  atlas_list_models:   { risk: "low", tags: ["read"] },

  // Web / network
  web_search: { group: "research", risk: "medium", tags: ["network", "external"] },

  // Research project ops — destructive variants
  research_source_delete:    { risk: "high", tags: ["destructive"] },
  research_project_continue: { risk: "medium", tags: ["write"] },
  research_project_create:   { risk: "medium", tags: ["write"] },

  // Turn helpers
  turn_after:   { group: "cognitive", risk: "low", tags: ["read", "ephemeral"] },
  turn_context: { group: "cognitive", risk: "low", tags: ["read", "prompt-build"] },
};

// ─── resolution ────────────────────────────────────────────────────────

/** Resolve full ToolMetadata for a tool name. Order:
 *   (1) exact name override (highest priority)
 *   (2) prefix rule
 *   (3) cognitive group fallback with risk="medium" (T1: fail-closed) */
export function resolveToolMetadata(toolName: string): ToolMetadata {
  const exact = EXACT_OVERRIDES[toolName];
  let group: ToolGroup = "cognitive";
  let risk: ToolRisk = "medium";
  const tags: string[] = [];

  // Apply prefix rule first as baseline.
  for (const rule of PREFIX_RULES) {
    if (toolName.startsWith(rule.prefix)) {
      group = rule.group;
      risk = rule.defaultRisk;
      break;
    }
  }

  // Exact override wins — merges/replaces baseline.
  if (exact) {
    if (exact.group) group = exact.group;
    if (exact.risk) risk = exact.risk;
    if (exact.tags) tags.push(...exact.tags);
  }

  // Always include the group tag for discoverability.
  if (!tags.includes(group)) tags.unshift(group);
  // Risk-level tag for filtering in the shell.
  if (!tags.includes(`risk:${risk}`)) tags.push(`risk:${risk}`);

  return {
    toolName,
    risk,
    tags,
    ...(exact?.displayName ? { displayName: exact.displayName } : {}),
    ...(exact?.description ? { description: exact.description } : {}),
  };
}

/** Build the full list of registrations for a tool roster. Returned in
 *  stable order (matches input) so the host can rely on it for cache
 *  invalidation if needed (T2 — pool ordering is cache-stable). */
export function buildToolMetadataList(toolNames: readonly string[]): ToolMetadata[] {
  return toolNames.map((name) => resolveToolMetadata(name));
}
