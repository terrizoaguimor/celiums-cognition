# Memory

The cognitive surface for *what the user said* — persistent across sessions,
agents, and machines.

## The two tools

### `recall(query, limit?)`

Search the operator's memory bank for entries semantically related to
`query`. Hybrid: FTS over `content` + cosine over 1024-dim TEI embeddings,
merged into a single ranked list. Returns rows with content, summary, PAD
axes, importance, retrieval_count.

**When to call:** at the START of a turn whenever the user references
prior context — names, past decisions, "you remember", "last time", "the
project". Cheap. If it returns nothing for a topic, that's the answer:
say so plainly. Inventing a memory because recall came up empty is the
single worst failure mode of this system.

### `remember(content, importance?)`

Append a new memory. The engine:

1. Embeds `content` via TEI → 1024-dim vector
2. Runs the ethics pipeline (rejects credential patterns, blocks if any
   law violated)
3. Computes PAD axes from the content + current limbic state
4. Auto-classifies memory_type (semantic, episodic, procedural)
5. Persists to `memories` (PG) and upserts to Qdrant
6. Touches the user's circadian state (last_interaction)

**When to call:** at the END of a meaningful exchange. Set `importance`
≥ 0.7 for explicit user corrections or stated preferences; ~0.5 for
context worth keeping; never below 0.3. Don't save trivia — every call
is free but pollutes recall when abused.

## PAD / VAD model

Every memory carries three affective axes:

| Axis | Range | What it captures |
|---|---|---|
| **Valence** | −1…+1 | pleasant ↔ unpleasant |
| **Arousal** | 0…1   | calm ↔ activated |
| **Dominance** | 0…1 | submissive ↔ in control |

These are the standard PAD (Pleasure-Arousal-Dominance) axes from
affective computing, originally from Mehrabian (1974). They flow into
**recall**: the engine retrieves memories with affect similar to the
current conversational state, not just topically similar ones. This is
what makes Cognition *persistent emotional* memory rather than plain
semantic search.

The PAD that every `remember` / `recall` response prints back at you is
**your engine's** state at this turn, not the user's mood. Calibrate
tone against it; don't announce it.

## Schema reference

`memories` table (PG):

| Column | Type | Meaning |
|---|---|---|
| `id` | text | uuid string |
| `user_id` | text | scope (one user = one memory bank) |
| `project_id` | text | optional project scope |
| `session_id` | text | optional session group |
| `content` | text | the captured fact (verbatim) |
| `summary` | text | engine-generated short version |
| `memory_type` | enum | semantic, episodic, procedural |
| `scope` | enum | project, global, session |
| `importance` | float | 0…1 |
| `emotional_valence` | float | −1…+1 |
| `emotional_arousal` | float | 0…1 |
| `emotional_dominance` | float | 0…1 |
| `confidence` | float | engine's trust in this memory |
| `strength` | float | decays with `decay_rate` |
| `retrieval_count` | int | times this memory was recalled |
| `tags` | text[] | engine-generated topical tags |
| `created_at` / `updated_at` | timestamptz | per-row |

## Reading the dashboard

The Memories tab shows:

- **List view** — paginated, sortable, filterable by valence bucket and
  time bucket (today / yesterday / last 7d / last 30d / last 365d). Each
  row shows VAD axes as small bars and the day-of-week + date.
- **Drawer** (click a row) — full content + summary + PAD breakdown +
  storage metadata + tags. Use this when paging back to a specific day
  — the full local-formatted timestamp anchors the conversation.

The date bucket math respects your timezone — set it under Settings → 
Timezone so the engine reads `user_profiles.timezone_iana` instead of
defaulting to UTC.
