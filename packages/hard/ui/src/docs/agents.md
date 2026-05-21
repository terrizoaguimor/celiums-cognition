# Agents & subagents

The plugin runs ONCE per gateway, but every agent and subagent that
OpenClaw dispatches through that gateway sees its full cognitive
surface. Scoping is explicit and important.

## What's shared, what's separate

| Surface | Scope key | Behaviour |
|---|---|---|
| **Memories** | `user_id` | Shared. Main, subagent A, subagent B all read/write the same memory bank. |
| **Journal** | `agent_id` | Separate per voice. Each agent has its own SHA-chained reflection stream. |
| **Ethics audit** | `user_id` | Shared. One operator, one policy log. |
| **Limbic state** | `user_id` | Shared snapshot, but each agent reads it fresh. |
| **Circadian** | `user_id` | Shared — the user has one rhythm, all agents synchronize. |
| **Identity preamble** | `agent_id` | Per agent. Each gets a small dynamic block telling it which id owns its journal entries. |

The design rule: **what is OBSERVATION (memories of the user) is
shared. What is INTERPRETATION (the agent's own reflections) is
private to that agent.**

## Why per-agent journals matter

When the operator runs a main agent + 3 subagents on a task, you
end up with up to 4 distinct voices each making local decisions.
If all four wrote to the same journal:

1. **Reflections would average out** — main's "I should be more
   direct" cancels subagent's "I should be more cautious", and the
   operator gets no signal.
2. **Confabulation would propagate** — one agent's wrong assertion
   becomes another's "remembered fact" via journal_recall.
3. **Tone would smear** — subagent X's clinical voice contaminates
   main's warm voice and vice versa.

Per-agent scoping is the cheapest possible fix: each chain stays
honest to its own voice, the operator can audit per-agent calibration
under load, and an agent that's drifting (lots of `doubt` entries
in its own chain) can be replaced or retrained without affecting
the others.

## How the plugin knows the agent_id

OpenClaw's SDK supplies a `PluginHookAgentContext` on every hook
invocation:

```ts
{
  agentId?: string,    // "main", "subagent-research", "deepseek-v4-pro", ...
  sessionKey?: string,
  sessionId?: string,
  conversationId?: string,
  ...
}
```

The plugin reads `ctx.agentId` in:

- `before_prompt_build` — to prepend the identity block ("you are agent
  `X`") to the system prompt.
- `agent_end` — to write the auto-journal entry under the correct
  `agent_id`.
- `subagent_spawning` / `subagent_spawned` / `subagent_ended` (future)
  — to track subagent lifecycle and link their journals to the
  parent's chain.

If `ctx.agentId` is missing (older SDK or test harness), the plugin
falls back to `cfg.agentId` (configurable, defaults to `"main"`).
**The plugin never invents an agent_id** — if it's missing, the
identity preamble explicitly tells the agent that and asks it not
to invent one.

## The dashboard's agent sidebar

Journal tab → left sidebar → "Agents on this gateway" card lists
every `agent_id` that has written at least one entry, with:

- Total entry count
- Last-written relative time
- Border tint hinting at average valence (green > +0.15, amber < −0.15)

Click an agent to filter the feed to its chain only. Click "All
voices" to return to the union view.

## Cross-agent reads

By default, `journal_recall` is scoped to the calling agent's own
chain — you can't read another agent's reflections without an
explicit grant. The exception is `journal_recall_secure` (in
`exposedTools: "all"` only), which can read across agents for
operator-level audits. This is rare and gated.

The reasoning: a subagent quoting main's `decision` entry as its
own "memory" is a confabulation risk. Cross-agent reads need the
operator's explicit blessing.
