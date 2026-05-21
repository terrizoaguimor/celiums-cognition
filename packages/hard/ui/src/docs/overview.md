# Celiums Cognition — overview

A persistent emotional memory layer for OpenClaw agents. The plugin gives every
agent (main + subagents) a long-term cortex on the operator's machine: durable
memories with affect tags, a hash-chained first-person journal per voice, a
multi-layer ethics pipeline, and a live limbic/circadian state that modulates
how the agent feels and responds.

## The mental model

Think of the plugin as four overlapping surfaces:

| Surface | What it persists | Where it lives |
|---|---|---|
| **Memory** | What the user said, decisions, preferences | `memories` table + Qdrant 1024-dim |
| **Journal** | What each agent *thought* about it (first-person) | `agent_journal` SHA-chained per `agent_id` |
| **Ethics** | What the pipeline blocked or flagged | `ethics_audit` append-only |
| **Affect** | Engine's PAD state + user's circadian rhythm | `user_profiles` + computed fresh-on-read |

Memories are **shared across the agent fleet** (one user, one memory bank).
Journals are **scoped per agent_id** (main + subagents each get their own
voice chain). Ethics is **shared** (one operator, one policy). Affect is
**per user_id** but read fresh on every memory operation.

## How a turn actually works

1. **`before_prompt_build`** — the plugin composes the system-prompt
   contribution: identity preamble (your agent_id) + 8-channel turn_context
   (identity, recall, limbic, ethics, continuity, …) + the static "how to
   operate this plugin" supplement. All injected before the LLM call.

2. **The agent acts** — calls `recall`, `remember`, `forage`, etc. through
   the OpenClaw tool surface. Each call routes through the ethics pipeline.

3. **`agent_end`** — when the turn closes, the plugin auto-captures a memory
   from the user's latest message + writes a baseline journal entry scoped
   to *this* agent's `agent_id`.

4. **Audit** — every ethics decision lands as a row in `ethics_audit` with
   layer trace, confidence, the prompt that triggered it (capped 2KB).

## What this plugin is NOT

- Not a chat history store — that's OpenClaw's job. We persist *significant*
  facts and reflections, not every line.
- Not a vector DB you bring memories to — the engine handles indexing.
- Not a single-agent system — explicitly designed so a fleet of agents
  (main + subagents) share memory but keep separate voices.

## Where to go next

- **[Memory](#docs?p=memory)** — recall, remember, PAD axes, importance scoring.
- **[Journal](#docs?p=journal)** — hash chain, entry types, why it's per-agent.
- **[Ethics](#docs?p=ethics)** — 5 layers, Three Laws, audit guarantees.
- **[Skills](#docs?p=skills)** — corpus, hybrid search, forage vs sense.
- **[Circadian](#docs?p=circadian)** — rhythm formula, time buckets, timezone setup.
- **[Agents & subagents](#docs?p=agents)** — scoping, isolation, shared bank.
- **[Failure modes](#docs?p=failure-modes)** — confabulation, sycophancy, hallucination, hyperfunctioning.
