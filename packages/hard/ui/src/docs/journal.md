# Journal

The agent's first-person reflective voice — append-only, SHA-256 hash
chained, scoped per `agent_id`.

## Why this exists

Plain memory captures *what was said*. The journal captures *what each
agent thought about it*. A `recall` can confirm an agent remembers a
topic; a `journal_recall` reveals whether it ever doubted itself on
that topic, decided one way then reversed, or quietly learned a lesson
the user never saw.

It's per-agent because **honest reflections from one voice are more
useful than averaged reflections across many**. When OpenClaw spawns
a subagent for a narrow task, that subagent's `doubt` and `lesson`
entries shouldn't pollute the main agent's chain — and vice versa.

## Entry types

```
reflection — a thought about how a session went
decision   — a choice the agent committed to
lesson     — a heuristic worth carrying forward
belief     — a stated position about the world or the user
emotion    — affect snapshot worth preserving
arc        — narrative thread spanning several sessions
doubt      — something the agent isn't sure about and wants flagged
```

The plugin auto-writes a baseline `reflection` (or `decision`, `doubt`)
at the close of every meaningful turn. Agents can add their own entries
via `journal_write` for finer detail.

## The hash chain

Each row in `agent_journal` carries:

| Column | Meaning |
|---|---|
| `id` | uuid |
| `agent_id` | scoping key — main, subagent name, model id |
| `session_id` | turn group (uuid per agent session) |
| `conversation_id` | finer thread (optional, set by the auto-journal) |
| `written_at` | timestamptz |
| `entry_type` | the seven types above |
| `content` | first-person prose |
| `valence` | −1…+1, the agent's felt sense of the entry |
| `valence_reason` | one-line justification |
| `tags` | text[], including `auto` for plugin-generated baseline entries |
| `preceded_by` | uuid[] — DAG predecessor for multi-step reasoning |
| `prev_hash` | SHA-256 of the prior entry's hash |
| `hash` | `SHA-256(id || agent_id || content || written_at || prev_hash)` |

A retroactive edit to any field invalidates `hash`. `journal_verify_chain`
walks the chain, recomputes, and reports any breaks — at the row level
("this entry's prev_hash doesn't match the actual previous hash") or
content level ("the stored hash doesn't match the recomputed hash from
content + timestamp").

## Retraction

The chain is **append-only**. To revise a stated belief, use
`journal_supersede(original_id, relation: "superseded" | "nuanced" |
"reaffirmed" | "recanted", new_entry)`. The new entry links to the
original; both stay in the chain. The operator can audit the full
history of changed positions.

## Per-agent dashboard

The Journal tab's left sidebar lists every agent that has written at
least one entry, with row count, last-written, and a border tint that
hints at average valence (green positive, amber negative > |0.15|).
Click an agent to filter the feed to only that voice.

## Reading entries on the dashboard

Click any entry to open the drawer:

- Full content (preserving line breaks)
- valence + the "why" line
- Hash chain table (hash, prev_hash, session/conversation IDs)
- `preceded_by` list when set
- Copy content / Copy JSON / Close
