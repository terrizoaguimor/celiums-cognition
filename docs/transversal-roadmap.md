# Transversal roadmap — Celiums Cognition × OpenClaw SDK

> **Status (2026-05-21): ALL SIX PHASES SHIPPED + VERIFIED IN
> PRODUCTION.** A→F closed between 2026-05-20 and 2026-05-21. See
> `CLAUDE.md §5.1` for the commit map. This document is preserved as
> the design rationale behind each Phase; the active project
> authority is now `docs/celiums-cognition-doctrine.md`.

**Theme (original):** The plugin used to live on its own island
(tools + UI + auth). The OpenClaw SDK exposes ~50 seams that let
Cognition thread itself into every step of the gateway's lifecycle.
This document inventoried the available seams, compared them against
what the plugin already used, and proposed the prioritized adoption
plan that was subsequently executed.

Verified against a local checkout of the `openclaw-study` SDK tree
(OpenClaw 2026.5.18+, commit `78d226bb`).

---

## Seams already in use at design time (8)

| Seam | Purpose | Status |
|---|---|---|
| `registerTool` | 61 MCP tools (curated 8 + all) | solid |
| `registerHttpRoute` | UI SPA + REST API `/api/celiums-cognition/*` | solid |
| `registerCli` | `openclaw celiums-cognition status` command | minimal |
| `registerService` | bootstrap stack + migrations + seed | solid |
| `registerMemoryPromptSupplement` | system-prompt teaching (Mario, 2026-05-21) | solid |
| `api.on("before_prompt_build")` | `turnContext` + identity preamble | solid |
| `api.on("agent_end")` × 2 | auto-capture + auto-journal | solid |
| `api.on("before_agent_run")` + `before_tool_call` | ethics gate | solid |

**Diagnosis:** the plugin observed the agent's lifecycle AND injected
memory into it, but did not participate in the other layers —
continuity, subagent lifecycle, channel messaging, session
boundaries, global audit, autonomous heartbeats — all flowed past
Cognition without it seeing anything.

---

## Transversal opportunities — prioritized

### 🔴 Phase A — Continuity across context limit

**Piece:** `registerCompactionProvider` + `api.on("before_compaction")`
+ `api.on("after_compaction")`.

**What happens today:** when the LLM context hits its limit, OpenClaw
compacts (summarize + drop older history). The plugin did NOT see this.
Whatever the agent "forgot" during compaction was lost unless someone
happened to call `remember()` just before.

**Proposal:**

1. Implement a `CompactionProvider` with id `celiums-cognition`. The
   signature is:
   ```ts
   summarize({ messages, compressionRatio, previousSummary }) => Promise<string>
   ```
   Our provider can use `journal_arc` (which the engine already
   ships — narrative synthesis with embeddings) and return a concise
   summary. NOT an exclusive slot (verified: the registry keys by
   `id`, supports multiple providers).

2. **Before compacting**, hook `before_compaction`:
   - Dump limbic + circadian state to the journal (entry type `arc`,
     tags `["pre-compaction"]`).
   - Extract the most important facts from context and persist them
     as memories (importance ≥ 0.7) if not already saved.

3. **After compacting**, hook `after_compaction`:
   - Write a `reflection` entry with the summary + the delta of what
     was lost.
   - The next `turnContext` can read that summary as a prior.

**Result:** the plugin becomes the **gateway's continuity engine**.
An agent never "loses" significant information when compacting —
persistent memory captures it BEFORE the loss.

**Cost:** ~300 lines. Risk: medium (critical path; must verify the
provider doesn't break agents already on memory-core).

---

### 🔴 Phase B — Agents and subagents

**Piece:** hooks `subagent_spawning`, `subagent_spawned`, `subagent_ended`.

**What happens today:** when OpenClaw spawns a subagent (for a narrow
task), the subagent arrives knowing NOTHING about what the parent
agent was thinking. Its journal entries are isolated in its own
`agent_id`. When it ends, its work is lost unless the parent captures
it manually.

Verified SDK payload:
```ts
PluginHookSubagentSpawnBase = {
  childSessionKey: string;
  agentId: string;       // the subagent's id
  label?: string;
  mode: "run" | "session";
  requester?: { channel, accountId, to, threadId };
  threadRequested: boolean;
}
```

**Proposal:**

1. **`subagent_spawning`** (before the child boots):
   - Emit a journal entry on the parent's chain: type `decision`,
     tags `["spawned-subagent"]`, content `"Spawning subagent <X> for
     task <Y>"`. `conversation_id` is shared between parent and child.
   - Pre-load the parent's most recent N journal entries as an
     additional **identity preamble** for the child — the child sees
     "I am subagent <X> at the service of <Y>; the parent agent
     recently decided Z, doubted W..."

2. **`subagent_spawned`** (child is live):
   - Link `child_agent_id ↔ parent_agent_id` in an `agent_lineage
     (parent, child, spawned_at, task_label)` table. This enables
     audits like "all of main's subagents during May".

3. **`subagent_ended`** (child finishes):
   - The child closes its own journal (type `arc`, work summary).
   - The parent receives a new journal entry: `lesson` or
     `reflection` depending on success, with tags
     `["from-subagent:<X>"]`, content = child summary + verdict.
   - Child work that matters to the operator is persisted as memories
     (auto-capture filtered by importance from the child).

**Result:** the agent fleet has **shared memory + separate voices +
traceable lineage**. Open the Journal tab → filter by `main` → see
"spawned 3 subagents during this session" + click to walk each chain.

**Cost:** ~400 lines + 1 migration (`agent_lineage` table).

---

### 🟡 Phase C — Session lifecycle

**Piece:** `api.on("session_start")` + `api.on("session_end")`.

**What happens today:** the plugin does not detect when a new
conversation opens or when one closes. The `conversation_id` passed
to the journal comes from the SDK's `sessionId`, which is fine, but
boundaries are not marked explicitly in the journal.

**Proposal:**

1. `session_start` → journal entry type `reflection`, tags
   `["session-start"]`, content `"New session opened via channel <X>
   from <accountId>"`. This acts as an **anchor** when the operator
   pages weeks back.

2. `session_end` → journal entry `arc`, tags `["session-end"]`,
   content = mini-summary of the topics covered (may call
   `journal_arc(query=this_session_id)` internally).

**Result:** the Journal tab can render "sessions" as a natural
grouping, not just continuous flow.

**Cost:** ~80 lines.

---

### 🟡 Phase D — Operator UX in the native shell

**Piece:** `registerSessionAction` + `registerControlUiDescriptor`.

**What happens today:** to record a memory or check limbic state, the
operator has to open the dashboard (another tab). In the conversation
with the agent there is no inline way to do it.

**Proposal:**

1. `registerSessionAction`: declares actions the operator can invoke
   as slash commands or shell buttons:
   - `/celiums-remember <text>` → calls `remember()` with high
     importance without opening the dashboard.
   - `/celiums-recall <query>` → shows the top 5 inline.
   - `/celiums-limbic` → shows the current PAD + circadian inline.
   - `/celiums-compact` → forces a compaction pass.

2. `registerControlUiDescriptor`: declares a widget for OpenClaw's
   native panel showing limbic state + last journal entry + memory
   count, always visible in the shell. Data via the
   `/api/celiums-cognition/limbic-state` endpoints we already have.

**Result:** Cognition stops being "the other tab" and becomes part
of the shell.

**Cost:** ~250 lines.

---

### 🟡 Phase E — Tooling extras

**Piece:** `registerToolMetadata` + `registerSecurityAuditCollector` +
`registerNodeInvokePolicy`.

**Proposal:**

1. `registerToolMetadata` — tag our 61 tools into groups (`memory`,
   `journal`, `ethics`, `cognitive`, `atlas`, `research`, `write`).
   The operator shell can group them visually; the agent can filter
   by category when calling.

2. `registerSecurityAuditCollector` — feed the gateway's GLOBAL audit
   system from our `ethics_audit` table. Each `final_decision: block`
   replicates to OpenClaw's central log to correlate with channel /
   auth events / etc.

3. `registerNodeInvokePolicy` — register ethics as an explicit
   POLICY, not just a hook. Some dangerous tools go through
   "approval" in OpenClaw; we want that path to consult our ethics
   pipeline as a second opinion.

**Result:** Cognition integrates with OpenClaw's governance
infrastructure, not just its own.

**Cost:** ~200 lines.

---

### 🟢 Phase F — Autonomous loops + channels

**Piece:** `heartbeat_prompt_contribution` + `tool_result_persist` +
`message_received` / `message_sent`.

**Proposal:**

1. `heartbeat_prompt_contribution` — for autonomous agents (cron-like
   loops), inject a mini-`turnContext` adapted to the heartbeat
   (shorter, only limbic + 3 most relevant memories).

2. `tool_result_persist` — selective capture of tool results as
   memories. Filter in: long `file_read`s, `web_search` with many
   results, successful `recall_remote`. Skip: list-dirs, no-op greps.

3. `message_received` / `message_sent` — for channels (Telegram,
   WhatsApp, Discord, Signal). Journal entries with channel metadata.
   The Journal tab then shows **"main agent · via telegram · 14:32"**
   on each entry, not just timestamps.

**Result:** Cognition observes the full gateway, not just direct
agent invocations.

**Cost:** ~300 lines.

---

## Executive summary

| Phase | Impact | Cost | Key piece |
|---|---|---|---|
| A. Continuity | 🔴 high | ~300 ln | `registerCompactionProvider` |
| B. Subagents | 🔴 high | ~400 ln + 1 migration | `subagent_*` hooks |
| C. Session lifecycle | 🟡 medium | ~80 ln | `session_start/end` |
| D. Operator UX | 🟡 medium | ~250 ln | `registerSessionAction` + Control UI |
| E. Governance | 🟡 medium | ~200 ln | toolMetadata + audit + policy |
| F. Autonomy + channels | 🟢 low | ~300 ln | heartbeat + persist + channel hooks |

**Recommended order:** A → B → C → E → D → F.

- A first because it solves the biggest problem of the day (memory
  lost on compaction).
- B next because Mario explicitly asked for per-agent robustness,
  and that's where the plugin becomes the backbone of agent fleets.
- C is cheap and brings order to the journal (a useful precondition
  for D and F).
- E is infrastructure work the operator doesn't notice immediately
  but matters for production trust.
- D is pure UX — pleasant but not transformational.
- F only when channels or autonomy modes are actually rolled in.

---

## What we won't implement, and why

- `registerProvider` / `registerSpeechProvider` /
  `registerImageGenerationProvider` etc. — we're a cognition plugin,
  not a model provider.
- `registerChannel` — we're memory, not a messaging channel.
- `registerContextEngine` — exclusive slot; memory-core likely owns
  it. Fighting for it doesn't beat `registerCompactionProvider`
  which is not exclusive.
- `registerTrustedToolPolicy` — bundled-only (CLAUDE.md §2b
  confirmed). External plugins cannot register it.
- `registerCodexAppServerExtensionFactory` — bundled-only.
- `registerAgentHarness` — we're memory, not a harness.
- `registerMigrationProvider` — only applies to systems with custom
  migrations; ours are plain SQL files run by the engine.

---

## Verification

- `registerCompactionProvider` shape verified in
  `openclaw-study/src/plugins/compaction-provider.ts:CompactionProvider`.
- Subagent payload verified in
  `openclaw-study/src/plugins/hook-types.ts:PluginHookSubagentSpawnBase`.
- Full hook list in
  `openclaw-study/src/plugins/hook-types.ts:PLUGIN_HOOK_NAMES`.
- Full `register*` list in
  `openclaw-study/src/plugins/types.ts:2492-2860`.

## Closing — 2026-05-21

All phases A-F shipped. Commit map:

- Phase A — `11cacf1`
- Phase B — `b56f0f2` (over `d492e90`/`f39fb17`/`9babbe4`)
- Phase B+ — `2ea13a6`
- Phase C — commit after the doctrine landed
- Phase D — `0153015`
- Phase E — `a2df9e2`
- Phase F — `6dbaa57`

Every phase went through: design → shape verification against real
SDK code → implementation with inline doctrine citations → green
build + typecheck → deploy to prod-openclaw + smoke. The gateway
runs 7 plugins including celiums-cognition with every seam cited
above active.

Subsequent work is incremental, not phase-shaped: ports + endpoints
+ adapters + dashboard widgets consuming the seams already wired.
