# Celiums Cognition — Doctrine

Authoritative principles for the `celiums-cognition` plugin. Owned by
Celiums Solutions LLC; original intellectual property. Numbered for
citability in commits, code comments, and future phase plans.

This document is **prescriptive, not narrative**. Read it once; cite the
principle codes (L1, P2, M4…) in pull requests; revisit only when a new
phase challenges a principle.

---

## 0. Meta-principles

1. **Density over verbosity.** Token efficiency is a first-class
   feature: in prompts, in journal entries, in commit messages, in this
   document. A reader's attention is the scarcest resource on this
   project. Cut every word that can be cut.
2. **Verify against code, never against memory.** SDK shapes, framework
   contracts, configuration enums — read the source. Memory recall is
   for narrative, not for facts that compile.
3. **Inspire, do not copy.** Celiums Cognition is original intellectual
   property. Patterns observed in other agents are abstracted to
   principles, then re-expressed in Celiums idiom — names, structure,
   prose all native to this codebase. No vendor strings, no derivative
   marketing language, no idiomatic borrowings that read as ports.

---

## 1. Loop and state (L)

- **L1 — Async generator as agent loop.** The agent emits events as an
  async generator; consumers decide what to render, persist, drop, or
  cancel. `AbortController` is the only cancellation contract. No
  parallel "should we stop?" flags.
- **L2 — State per iteration is immutable; transitions are named.** Each
  loop continuation reassigns a snapshot, never mutates fields in place,
  and declares a discrete `transition` reason. Auditable by design;
  reducer-shaped later if needed.
- **L3 — Recovery pipelines are monotonic.** When the loop hits a
  recoverable failure (context overflow, output truncation, transport
  hiccup), recovery moves forward through declared stages with
  one-shot `attempted` flags. Never retries the same stage twice.
  Unrecoverable failures cut clean.
- **L4 — Withhold errors during recovery.** Transient errors are not
  yielded to consumers until recovery is decided. UIs that show every
  intermediate failure cause user panic and false retries.

## 2. Tools and capabilities (T)

- **T1 — Tool contract is wide; defaults are fail-closed.** A tool
  declares many optional facets (validate, permissions, render,
  isReadOnly, isDestructive, isConcurrencySafe, maxResultSize). Helpers
  fill defaults that fail closed (not read-only, destructive unknown,
  concurrency-unsafe). Minimalism here costs safety.
- **T2 — Tool pool ordering is cache-stable.** Built-in tools sorted
  alphabetically, MCP tools sorted alphabetically and appended. The
  prefix-cache boundary lies between the two. Adding or shuffling
  tools must preserve this invariant or every session pays a cache
  miss.
- **T3 — Slash commands have three flavours with declarative metadata.**
  Local output, local UI, prompt expansion. Metadata (name, description,
  argument hint, allowed tools, availability) is pure data declared in
  the manifest; handlers are lazy-imported. Permission gates and dead
  code elimination flow naturally from this shape.
- **T4 — Tools and identity are orthogonal axes.** Who the agent is
  (identity prompt) and what it can do (tool roster) are declared in
  separate slots and composed at handshake time. Never bake one into
  the other.

## 3. Prompt architecture (P)

- **P1 — Compose by pure functions that may return null.** A system
  prompt is a list of section functions; sections that don't apply
  return null and are filtered out. No string concatenation with
  conditional flags inline. Adding or removing a contribution is a
  one-line addition to the registry.
- **P2 — Cache boundary is explicit.** Place a sentinel marker between
  stable content (cached across sessions) and volatile content
  (per-turn). Anything runtime that lands before the boundary
  multiplies prefix-cache variants and burns dollars silently. Document
  the why for any boundary crossing.
- **P3 — Identity first, then constraints, then capabilities.** In
  read-only or safety-critical agents, restrictions go above the
  positive permission list. The model gravitates to the loudest signal.
- **P4 — Meta-cognitive anti-rationalization.** When a verifier or gate
  expects the model to skip work, enumerate the excuses it will use
  ("looks fine to me", "trivial change") and ask it to recognize them
  as signals. Far more effective than another "always check" line.
- **P5 — Format with good and bad examples.** When the caller parses
  output (verifier verdict, summary template, fork report), provide
  one example of correct output and one of common-but-wrong. Description
  alone underperforms.
- **P6 — Each durable rule carries Why + How-to-apply.** A rule
  ("never mock the database in tests") without its motivating incident
  and its scope-of-application is brittle. Future readers cannot
  reason about edge cases.
- **P7 — Prompt iteration is eval-driven.** Section position, header
  wording, bullet grouping — all are artefacts of measurement. When a
  rule changes, log the eval delta in the commit. Opinion is the worst
  signal in this domain.

## 4. Memory and context (M)

- **M1 — Single index + lazy topic files.** Memory is a one-file manifest
  always loaded (tightly truncated) plus per-topic files fetched only
  when relevant. Loading "all memory" into every turn is anti-cache
  and anti-attention.
- **M2 — Side-query for relevance.** A small, cheap model selects which
  topic files to inject based on the current task and recent tool
  calls. The main agent never reads the full memory store.
- **M3 — Closed taxonomy with explicit "what NOT to save".** Memory
  types are a closed list (user, feedback, project, reference); the
  "do not save" list is explicit (anything derivable from `git log`,
  current code, or activity summaries). Pressure goes on WHAT to
  record, not on HOW.
- **M4 — Truncated output is self-explanatory.** Any payload that gets
  cut — recall blob, journal entry, file read — embeds a note saying
  what was truncated and how the reader can retrieve more. No silent
  ellipsis.
- **M5 — Compaction is a first-class message.** When the context
  window rotates, emit a typed `compaction_boundary` message with
  pre/post token counts and a structured summary. Splice pre-boundary
  messages out for GC. Resume always respects the boundary.
- **M6 — Recall results carry a recovery instruction.** When a recall
  returns 0 hits or hits the limit, include a literal one-line
  instruction telling the model what query to try next. The model
  cannot guess our memory schema.

## 5. Operator UX (U)

- **U1 — Input is a structured domain, not a text field.** Cursor,
  modes, resolved references (paste IDs, file refs, image refs), stash
  state, command history. Treating input as a string is the first
  source of bugs.
- **U2 — Mode is a discriminated union, not derived from content.**
  Chat, plan, bash, picker, dialog, vim-normal — each changes what
  keys mean. Never infer mode from the input contents.
- **U3 — Interrupt is jerarquical, with a documented order.** A single
  escape key has priorities: (1) abort active tool, (2) pop queued
  command, (3) close overlay, (4) exit mode. The order is contractual,
  not emergent.
- **U4 — Permission requests are a typed family with mandatory reason.**
  Each destructive action has its own request component, explanation,
  and persisted-rule option. A flat yes/no dialog leaks intent.
- **U5 — Four critical metrics, not twenty widgets.** A status line
  shows: identity (model + capability tier), permissions mode, budget
  (context % + cost), activity (what the agent is doing right now).
  Everything else is noise.
- **U6 — Double-press for destructive actions.** First press arms the
  intention with a visible hint; second press within a window executes.
  Applies to kill-all, exit-session, forget-memory.
- **U7 — Notifications stream in-band.** Rate limits, plugin updates,
  IDE connections route through one notification stream that the
  render layer schedules. Never interrupt input with a modal.
- **U8 — Speculative pre-compute with cancellation.** While the user
  types a query, pre-compute the recall in the background; discard if
  the input changes. Latency wins without token waste.

## 6. Lifecycle and governance (G)

- **G1 — Hooks are typed extension points.** Each lifecycle event
  (session start/end, before/after tool call, before/after compaction,
  subagent spawn/end, agent end) accepts handlers that yield progress,
  return blocking errors as re-injected meta-messages, or signal
  `preventContinuation`. Blocking errors are user-visible, named, and
  carry a recovery instruction.
- **G2 — Anti-confabulation on async results.** When the agent spawns
  a fork or schedules an async tool, it must never fabricate or guess
  the result. Notifications arrive in the next turn as user-role
  meta-messages. The system prompt makes this explicit.
- **G3 — Permission rules are layered by source.** `cliArg`, `session`,
  `userSettings`, `projectSettings` — each rule carries its source so
  audit trails can reconstruct who allowed what and when. Subagents
  inherit explicit (cliArg) rules but not implicit (session) ones.
- **G4 — Subagent prompts are self-contained.** Never write "based on
  your findings, implement…" The coordinator synthesizes; the worker
  reads only its own brief. Each subagent's prompt is a full, fresh
  task description.
- **G5 — Lineage tracked by causal IDs.** Every tool call has an ID,
  every agent has an agent ID, every chain has depth and root. Any
  consumer (transcript, dashboard, telemetry) reconstructs the tree
  from IDs alone, without ambient state.

## 7. Infrastructure (I)

- **I1 — Bootstrap is layered by cost.** Cheap synchronous setup first
  (config, env validation, TLS); expensive parallel work fired and
  forgotten; user-facing prompt only after critical gates pass. Fast
  paths cortocircuitan before the full tree loads.
- **I2 — Dynamic imports are dead-code elimination.** Anything gated
  by an edition or feature flag is `void import()`'d so the bundler
  can prune. Lite edition must not pay for Hard edition's Docker stack
  in its bundle, even as dead code.
- **I3 — Migrations are idempotent and tracked.** Each migration is
  a function with one-shot guards; the runner persists `(version,
  sha256, applied_at)` and refuses to proceed on file-content drift.
  *Already implemented in `celiums_migrations` table — verified.*
- **I4 — Global state is a flat struct.** One module-scope object
  initialized by a `getInitialState()` function, getters and setters
  exposed as named functions, a single `reset()` for tests. No classes
  with hidden state, no singletons via dependency injection.
- **I5 — Service registry, hooks merge, cleanup ordered.** Services
  register `start`/`stop`; hooks for the same event are merged into
  an array (never overwritten); cleanup is invoked in reverse
  registration order in a `finally`. Death is as predictable as birth.
- **I6 — Health gates declare fail-open vs fail-closed.** Each
  bootstrap step says explicitly whether a failure aborts the whole
  startup or surfaces a warning and proceeds degraded. Silent partial
  init is the worst state.

---

## Anti-patterns (A)

Practices this codebase explicitly does not adopt.

- **A1 — Bimodal utilities.** Hundreds of microscopic files (< 100
  lines, more import overhead than logic) alongside a handful of
  god-modules (> 1500 lines). Aim for cohesive domain modules in the
  300–800 line range.
- **A2 — Splitting by keyword instead of domain.** Eight files for
  "where things live on disk" is fragmentation. One coherent `paths`
  module with branches is navigable.
- **A3 — `Portable` suffixed duplicates.** Cross-platform branches
  belong inside one module's `process.platform` switch, not two files.
- **A4 — Feature flags inlined over entire modules.** Bundle-time
  tree-shaking is fine; chained `feature('X') && require(...)!.foo`
  in business logic is unreadable. Hold flags in a central registry.
- **A5 — Deprecation visible inline.** `_DEPRECATED` suffixes and
  `slowOperations.ts` files are debt that needs an issue and a date,
  not a comment.
- **A6 — `process.env` mutated at top level before imports.** Module
  init order makes this fragile. The host injects env vars before
  invoking the plugin; the plugin never mutates them.
- **A7 — Cache-buster latches with no reset path.** A flag toggled to
  preserve prefix cache that can never be cleared without `/clear` is
  technical debt. Always document the reset trigger.
- **A8 — God components mixing input, render, and agent loop.**
  Extract by function (orchestration, view, transport), not by layer.

---

## Application to phases

### Fase C — Session lifecycle

Apply **P1** (sections as null-suppressible functions) and **P2**
(cache boundary marker). The journalMode toggle proposed earlier is
removed: with composable sections a session-start entry is essentially
free. Apply **M4** to the end-of-session arc (truncated counts cite
where the full data lives). **I3** already satisfied by the engine's
`celiums_migrations` table — no new tracking table.

### Fase D — Operator UX

Slash commands via **T3** with metadata in `openclaw.plugin.json`'s
`commandAliases`; handlers lazy. Status widget exposes the **U5**
quartet adapted for cognition: context %, journal head hash, ethics
mode, recall count. Destructive actions (forget, redact, bulk delete)
through **U4** typed permission requests with mandatory reason and
**U6** double-press.

### Fase E — Governance

Ethics gate registered via `api.on("before_tool_call")` (**G1**)
returning `InputGateDecision { decision, reason, source }`. Rules
layered by source per **G3** with full audit trail in `ethics_audit`.
When the policy changes context-dependently, mark the affected prompt
section explicitly (P2 boundary discipline).

### Fase F — Autonomy loops and channel hooks

Loop as async generator with `AbortController` (**L1**). Recovery
pipeline for transient stack failures (pg, qdrant, valkey) per **L3**.
Channel hooks (Telegram, Slack, web push, journal-cross-agent) as
mailbox-style bridges with their own pollers — never push state into
shared UI directly. Backpressure-aware queue for journal writes during
long-running loops (**I5**). **G2** anti-confabulation enforced in
proactive ticks: never narrate a result before the async work returns.

---

## Citing this doctrine

In commits: `feat(hard): Fase X — applies P1/P2/M4 + G1 (see doctrine §3,§4,§6)`.

In code comments: `// G3: rules layered by source (see doctrine §6).`

In journal entries: `Decision drives from doctrine M5 (compaction as
first-class message) — splice pre-boundary out, …`.

This file is the contract. Changes require an explicit Mario+session
decision; cite in the commit that amends it.
