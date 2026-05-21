/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// CLI subcommand — `openclaw <edition.id> status` prints a one-line
// summary. Minimal surface today; future commands (e.g. `forget`,
// `journal`, `audit`) can layer on top via additional subcommands.

import type { PluginContext } from "../context.js";

export function wireCli(ctx: PluginContext): void {
  const { api, cfg, userId, edition } = ctx;

  api.registerCli(
    async ({ program }: { program: { command: (n: string) => unknown } }) => {
      const cmd = program.command(edition.id) as {
        description: (d: string) => { action: (fn: () => void) => void };
      };
      cmd
        .description("Celiums Cognition status")
        .action(() => {
          // eslint-disable-next-line no-console
          console.log(
            `${edition.name} — userId=${userId} exposedTools=${cfg.exposedTools} ethics=${cfg.ethics.enabled}`,
          );
        });
    },
    { descriptors: [{ name: edition.id, description: "Celiums Cognition", hasSubcommands: false }] },
  );
}
