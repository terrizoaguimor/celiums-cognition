# Celiums Cognition — examples

Concrete walkthroughs of the surfaces the plugin wires into an
OpenClaw agent. Each example assumes the plugin is installed and
the gateway is running at `http://localhost:18789`.

| Example | What it shows |
|---|---|
| [`auto-recall.md`](./auto-recall.md) | The 8-channel turn_context the agent receives on every prompt — identity, memories, briefing, ethics advisory, suggestions, limbic state. |
| [`ethics-block.md`](./ethics-block.md) | The five-layer ethics pipeline gating a tool call. Block decision carries category, source, audit trail. |
| [`subagent-lineage.md`](./subagent-lineage.md) | Parent ↔ child relationship, loop guard, briefing of the child with relevant parent journal entries, retrospective entries at end. |
| [`journal-hash-chain.md`](./journal-hash-chain.md) | Verifying the SHA-256 chain after the fact. Detecting a tamper attempt without trusting the row in pg. |

Every example uses `curl` against the public REST API so it works
identically from a script, a CI job, or your terminal. Replace the
session cookie placeholder with one from your browser's devtools (or
sign in via the dashboard and copy `celiums_sid`).
