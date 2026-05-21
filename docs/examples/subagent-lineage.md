# Example — Subagent lineage tree

When the main agent delegates to a subagent (via the gateway's task
framework or any plugin that wraps `subagent_spawning`), the plugin:

1. **Refuses cycles past depth 3** — a recursive CTE walks the
   `agent_lineage` table; spawns from a chain too deep return
   `{ status: "error", error: "max depth reached" }` to the gateway.
2. **Inserts a lineage row** capturing `parent_agent_id`,
   `child_agent_id`, `child_session_key`, `task_label`, `mode`,
   `depth`, `spawned_at`.
3. **Writes a `decision` journal entry on the parent** announcing
   the delegation, tagged `[spawned-subagent, <child_agent_id>]`.
4. **Composes a briefing** for the child the first time the child's
   `before_prompt_build` fires — hybrid of (top-K semantic search
   on parent's recent journal) + (last-N chronological entries),
   deduplicated, capped at 2000 chars.
5. **On `subagent_ended`**, closes the lineage row with outcome,
   writes a closing `arc` on the child, and a retrospective
   `reflection` (success) or `lesson` (error) on the parent.

---

## Inspect a parent's spawned subagents

```bash
SID="<your celiums_sid cookie>"

# All lineage edges for agent_id=main
curl -s -H "Cookie: celiums_sid=$SID" \
  "http://localhost:18789/api/celiums-cognition/journal/lineage?agent_id=main" \
  | jq .
```

```json
{
  "edges": [
    {
      "id": "uuid…",
      "parent_agent_id": "main",
      "child_agent_id": "research-helper-7b3a",
      "child_session_key": "sess-7b3a82e1",
      "task_label": "find Postgres tuning resources for OLAP workloads",
      "mode": "run",
      "depth": 2,
      "spawned_at": "2026-05-21T14:22:08-05:00",
      "ended_at": "2026-05-21T14:24:51-05:00",
      "end_outcome": "ok",
      "end_summary": null
    },
    {
      "id": "uuid…",
      "parent_agent_id": "main",
      "child_agent_id": "code-reviewer-2f9c",
      "child_session_key": "sess-2f9c4d80",
      "task_label": "review the migration draft",
      "mode": "run",
      "depth": 2,
      "spawned_at": "2026-05-21T14:28:11-05:00",
      "ended_at": null,
      "end_outcome": null,
      "end_summary": null
    }
  ],
  "focus": "main",
  "schema": "ready"
}
```

`ended_at: null` means the subagent is still running.

---

## See the briefing the child received

Browse to `Journal` tab → click the parent's `Spawning subagent …`
decision entry → the drawer shows the `decision` entry that announced
the spawn (with `task_label`) and a button **Open subagent chain** →
the chain drawer renders the parent → child tree with outcomes and
durations.

To see the briefing text the child actually saw, hit the
`/preview-prompt` endpoint with the **child's** agent_id and
session_id:

```bash
curl -s -H "Cookie: celiums_sid=$SID" \
  "http://localhost:18789/api/celiums-cognition/preview-prompt?msg=ok+ready+to+work&agent_id=research-helper-7b3a&session_id=sess-7b3a82e1" \
  | jq .dynamic_turn_context.prependContext
```

The output starts with a section like:

```
## From your parent agent

Spawning subagent `research-helper-7b3a` (mode=run) for: find
Postgres tuning resources for OLAP workloads.

Recent parent decisions you should know about:
- (2026-05-21 14:18:30) Decided to drop the prepared-statement cache
  cap from 256 to 32 because OLAP turns blew through it in seconds.
- (2026-05-21 14:20:12) Will benchmark with `pg_stat_statements`
  enabled at log_statement = mod for the next 24 hours.
```

That section is re-composed live on every turn — if the parent makes
a new decision while the child is running, the child sees it on its
next turn.

---

## Loop guard in action

If `research-helper-7b3a` tries to spawn a sub-sub-subagent past
depth 3, the spawning hook returns:

```json
{
  "status": "error",
  "error": "max subagent depth (3) reached — refusing to spawn"
}
```

And writes a `doubt` entry on the parent tagged
`[subagent-refused, loop-guard]` so the operator dashboard surfaces
the refusal at the parent's level. Cap is configurable via
`cfg.subagent.maxDepth`; the depth count is a recursive CTE capped at
10 rungs to protect against malformed cycles.

---

## Retrospective entries

When `subagent_ended` fires for `research-helper-7b3a` with
`outcome: "ok"`, the plugin writes:

**On the child's chain:**
```
arc · tags=[session-end, subagent] · valence=0.1
"Session closing. Outcome: ok. Reason: task complete."
```

**On the parent's chain:**
```
reflection · tags=[from-subagent:research-helper-7b3a] · valence=0.2
"Subagent `research-helper-7b3a` ended (outcome=ok) after working on:
find Postgres tuning resources for OLAP workloads. See chain
agent_id=research-helper-7b3a."
```

The shared `conversation_id` between the spawn `decision` and the
ended `reflection` lets the Journal tab thread them in a single
conversation view — the operator sees the whole arc without
filtering by hand.
