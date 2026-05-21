/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Tool curator — `exposedTools: "curated"` (default) shows a small essential
// surface; `"all"` shows every engine tool.
//
// NOTE: an early design draft listed `pad_state`/`circadian_now` as curated
// tools, but verified against the real engine they are NOT MCP tools
// (PAD/circadian are internal engine state, surfaced via auto-recall context,
// not callable tools). The curated allowlist below uses only REAL engine
// tool names (verified from buildRegistry()): opencore `recall/remember/
// forage/sense`, `journal_write/journal_recall`, `ethics_trace`,
// `map_network`. Unknown names are skipped defensively.

export interface EngineToolLike {
  group: string;
  definition: { name: string; description?: string; inputSchema?: unknown };
  handler: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
}

/** Essential 8-ish surface — real engine tool names only. */
export const CURATED_TOOL_NAMES: readonly string[] = [
  "recall",
  "remember",
  "forage",
  "sense",
  "journal_write",
  "journal_recall",
  "ethics_trace",
  "map_network",
] as const;

/**
 * Select the tool subset to expose. `curated` keeps only CURATED_TOOL_NAMES
 * that actually exist in the registry (defensive — never references a
 * non-existent tool). `all` returns the full registry untouched.
 */
export function selectTools<T extends EngineToolLike>(
  registry: T[],
  mode: "curated" | "all",
): T[] {
  if (mode === "all") return registry;
  const wanted = new Set(CURATED_TOOL_NAMES);
  return registry.filter((t) => wanted.has(t.definition.name));
}
