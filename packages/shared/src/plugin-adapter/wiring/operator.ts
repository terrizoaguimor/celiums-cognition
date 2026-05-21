/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Operator-facing wirings: session actions (slash commands the operator
// invokes directly), control UI descriptor (the cognition status
// widget), and the memory prompt supplement (cache-stable system-prompt
// section the model sees every turn). All three feature-detected; older
// gateways skip silently with a single warn.

import {
  buildOperatorActions,
  COGNITION_STATUS_DESCRIPTOR,
  type ActionDeps,
} from "../operator-actions.js";
import { buildMemoryPromptSupplement } from "../../prompt-supplement/index.js";
import { deriveEthicsMode } from "../../config-schema/index.js";
import type { PluginContext } from "../context.js";

export function wireOperatorActions(ctx: PluginContext): void {
  const { api, cfg, userId, getEngine, extractEnginePool } = ctx;

  const actionDeps: ActionDeps = {
    getEngine,
    extractPool: extractEnginePool as never,
    userId,
    agentId: cfg.agentId,
    ethicsMode: deriveEthicsMode(cfg),
    logger: {
      info: (m: string) => api.logger.info(m),
      warn: (m: string) => api.logger.warn?.(m),
    },
  };
  const operatorActions = buildOperatorActions(actionDeps);

  const registerSessionAction = (
    api as unknown as { registerSessionAction?: (action: unknown) => void }
  ).registerSessionAction;
  if (typeof registerSessionAction === "function") {
    for (const action of operatorActions) {
      try {
        registerSessionAction.call(api, action);
        api.logger.info(`celiums-cognition: registered session action ${action.id}`);
      } catch (err) {
        api.logger.warn?.(
          `celiums-cognition: failed to register action ${action.id}: ` +
          (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  } else {
    api.logger.warn?.(
      `celiums-cognition: api.registerSessionAction not available — operator slash commands skipped on this gateway`,
    );
  }

  const registerControlUiDescriptor = (
    api as unknown as { registerControlUiDescriptor?: (descriptor: unknown) => void }
  ).registerControlUiDescriptor;
  if (typeof registerControlUiDescriptor === "function") {
    try {
      registerControlUiDescriptor.call(api, COGNITION_STATUS_DESCRIPTOR);
      api.logger.info(
        `celiums-cognition: registered control UI descriptor (${COGNITION_STATUS_DESCRIPTOR.id})`,
      );
    } catch (err) {
      api.logger.warn?.(
        `celiums-cognition: failed to register control UI descriptor: ` +
        (err instanceof Error ? err.message : String(err)),
      );
    }
  } else {
    api.logger.warn?.(
      `celiums-cognition: api.registerControlUiDescriptor not available — cognition widget skipped on this gateway`,
    );
  }
}

export function wireMemoryPromptSupplement(ctx: PluginContext): void {
  const { api } = ctx;
  try {
    const maybeRegister = (api as unknown as {
      registerMemoryPromptSupplement?: (
        builder: (params: { availableTools?: unknown; citationsMode?: unknown }) => string[],
      ) => void;
    }).registerMemoryPromptSupplement;
    if (typeof maybeRegister === "function") {
      maybeRegister.call(api, (params: { availableTools?: unknown; citationsMode?: unknown }) => {
        const tools = params?.availableTools as Set<string> | string[] | undefined;
        return buildMemoryPromptSupplement(tools);
      });
      api.logger.info(`celiums-cognition: registered memory prompt supplement`);
    } else {
      api.logger.warn?.(
        `celiums-cognition: api.registerMemoryPromptSupplement not available on this host — model will not see the operating guide`,
      );
    }
  } catch (err) {
    api.logger.warn?.(
      `celiums-cognition: failed to register prompt supplement: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
