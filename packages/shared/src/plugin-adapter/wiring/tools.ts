/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Tool registration loop — turns the engine's MCP tools into OpenClaw
// tools the agent can invoke. Curated subset vs full surface gated by
// cfg.exposedTools. Tool metadata (group + risk + tags) feature-
// detected per-iteration so a host without registerToolMetadata
// silently skips. Doctrine T1 (fail-closed defaults), T2 (cache-stable
// ordering).

import {
  buildRegistry, type CeliumsMemoryConfig as _C,
} from "@celiumsai/cognition-engine";
import {
  selectTools, CURATED_TOOL_NAMES,
  type EngineToolLike,
} from "../../tool-curator/index.js";
import { resolveToolMetadata } from "../tool-metadata.js";
import type { PluginContext } from "../context.js";

const CURATED_SET = new Set<string>(CURATED_TOOL_NAMES);

/** Returns the resolved tools list (used by other wirings that need
 *  to know the tool set — e.g. the manifest validator). The registry
 *  itself isn't memoized across calls; cheap enough. */
export function wireTools(ctx: PluginContext): Array<EngineToolLike> {
  const { api, cfg, getEngine, getModuleStore, extractEnginePool, toolCtx } = ctx;

  const registry = buildRegistry() as unknown as Array<
    EngineToolLike & {
      handler: (a: Record<string, unknown>, c: unknown) => Promise<{
        content: Array<{ type: "text"; text: string }>;
        isError?: boolean;
      }>;
    }
  >;
  const tools = selectTools(registry, cfg.exposedTools);
  api.logger.info(
    `celiums-cognition: registering ${tools.length}/${registry.length} tools (${cfg.exposedTools})`,
  );

  for (const tool of tools) {
    api.registerTool(
      {
        name: tool.definition.name,
        label: tool.definition.name,
        description: tool.definition.description ?? tool.definition.name,
        parameters: (tool.definition.inputSchema ?? {
          type: "object",
          properties: {},
        }) as never,
        async execute(_toolCallId: string, params: unknown) {
          try {
            const engine = await getEngine();
            const pool = extractEnginePool(engine);
            const moduleStore = getModuleStore();
            const res = (await tool.handler(
              (params ?? {}) as Record<string, unknown>,
              {
                ...toolCtx(),
                memoryEngine: engine,
                ...(pool ? { pool } : {}),
                ...(moduleStore ? { moduleStore } : {}),
              },
            )) as { content: Array<{ type: "text"; text: string }>; isError?: boolean };
            return { content: res.content, ...(res.isError ? { isError: true } : {}) };
          } catch (err) {
            return {
              content: [{ type: "text", text: `celiums-cognition error: ${String(err)}` }],
              isError: true,
            };
          }
        },
      } as never,
      CURATED_SET.has(tool.definition.name)
        ? { name: tool.definition.name }
        : { name: tool.definition.name, optional: true },
    );

    // Tool metadata (Fase E) — feature-detected per iteration.
    const registerToolMetadata = (
      api as unknown as { registerToolMetadata?: (m: unknown) => void }
    ).registerToolMetadata;
    if (typeof registerToolMetadata === "function") {
      try {
        const meta = resolveToolMetadata(tool.definition.name);
        registerToolMetadata.call(api, {
          toolName: meta.toolName,
          risk: meta.risk,
          tags: meta.tags,
          ...(meta.displayName ? { displayName: meta.displayName } : {}),
          ...(meta.description ? { description: meta.description } : {}),
        });
      } catch (err) {
        api.logger.warn?.(
          `celiums-cognition: registerToolMetadata failed for ${tool.definition.name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  return tools;
}
