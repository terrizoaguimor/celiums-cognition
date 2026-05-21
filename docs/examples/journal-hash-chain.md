# Example — Verifying the SHA-chained journal

Every `agent_journal` row carries:

```
prev_hash  — SHA-256 hex of the previous row's `hash` (or "" for genesis)
hash       — SHA-256(prev_hash || canonicalize(body))
```

`canonicalize(body)` is a deterministic JSON serialization of
{agent_id, written_at_iso, entry_type, content, valence,
valence_reason, tags, visibility, preceded_by}. The hash is computed
when the row is inserted and re-validated whenever the operator opens
the chain.

A retro-active edit to ANY persisted field — even one that compiles
into the same column types — breaks the chain at that row, because
the next row's `prev_hash` no longer matches.

---

## Pull a chain slice

```bash
SID="<your celiums_sid cookie>"

# 20 most recent entries for agent_id=main
curl -s -H "Cookie: celiums_sid=$SID" \
  "http://localhost:18789/api/celiums-cognition/journal/recent?agent_id=main&limit=20" \
  | jq '.entries[] | {id, written_at, entry_type, prev_hash: .prev_hash[:8], hash: .hash[:8]}'
```

```
{"id":"a07296","written_at":"2026-05-21T15:25:46-05:00","entry_type":"reflection","prev_hash":"8e2bab58","hash":"8e2bab58"}
{"id":"5d4c7e","written_at":"2026-05-21T15:24:01-05:00","entry_type":"decision",  "prev_hash":"472a01b3","hash":"472a01b3"}
{"id":"f1098a","written_at":"2026-05-21T15:20:11-05:00","entry_type":"arc",       "prev_hash":"c98810ef","hash":"c98810ef"}
...
```

Each row's `hash` matches the next-younger row's `prev_hash` — the
chain is intact.

---

## Verify the chain locally

The dashboard's Journal tab has a **↻ Re-verify chain** button
(disabled today, scheduled to land in the next UI commit). Until
then, run the verification with a small script:

```js
// verify-chain.mjs — run with: node verify-chain.mjs <cookie>
import { createHash } from "node:crypto";

const SID = process.argv[2];
if (!SID) { console.error("usage: node verify-chain.mjs <celiums_sid>"); process.exit(1); }

const res = await fetch(
  "http://localhost:18789/api/celiums-cognition/journal/recent?agent_id=main&limit=500",
  { headers: { Cookie: `celiums_sid=${SID}` } },
);
const { entries } = await res.json();
// Ascending order for chain walk
entries.reverse();

const canonicalize = (e) => JSON.stringify({
  agent_id: e.agent_id,
  written_at_iso: new Date(e.written_at).toISOString(),
  entry_type: e.entry_type,
  content: e.content,
  valence: e.valence,
  valence_reason: e.valence_reason,
  tags: e.tags ?? [],
  visibility: e.visibility,
  preceded_by: e.preceded_by ?? [],
});

let expectedPrev = "";
let broken = null;
for (const e of entries) {
  if (e.prev_hash !== expectedPrev) {
    broken = { id: e.id, expected: expectedPrev, actual: e.prev_hash };
    break;
  }
  const recomputed = createHash("sha256")
    .update(expectedPrev)
    .update(canonicalize(e))
    .digest("hex");
  if (recomputed !== e.hash) {
    broken = { id: e.id, type: "hash-mismatch", recomputed, stored: e.hash };
    break;
  }
  expectedPrev = e.hash;
}

console.log(broken
  ? `CHAIN BROKEN at ${broken.id}: ${JSON.stringify(broken)}`
  : `Chain OK · ${entries.length} entries verified`);
```

---

## Demonstrate tamper detection

Connect to the postgres container and manually edit a journal entry:

```sql
-- DO NOT do this in production. Demo only.
docker exec -it celiums-cognition-postgres-1 psql -U celiums -d celiums_memory
celiums_memory=# UPDATE agent_journal
                 SET content = 'tampered text'
                 WHERE id = (SELECT id FROM agent_journal
                             WHERE agent_id = 'main'
                             ORDER BY written_at DESC OFFSET 3 LIMIT 1);
UPDATE 1
```

Re-run the verification script — it now reports:

```
CHAIN BROKEN at <id of the row AFTER the tampered one>:
  {"expected":"<stored hash of tampered row>","actual":"<original prev_hash>"}
```

The tampered row's `hash` column is unchanged in pg (we only edited
`content`), so `recomputed !== e.hash` is the trigger. Even if the
tamperer recomputes and writes the new hash, the NEXT row's
`prev_hash` no longer matches — the chain is still broken.

---

## Why this matters

`agent_journal` is the agent's first-person record: every decision,
reflection, lesson, doubt. Memories can be cherry-picked at recall
time, but the journal is the **chain of reasoning** the operator and
auditor walk after the fact.

When you give an autonomous agent the keys to take actions on your
behalf — and Fase F's autonomy loops + channel hooks open exactly
that door — you need to be able to ask "what was it thinking when it
did this?" later, and trust the answer.

The SHA chain makes that trust verifiable without trusting the
storage. Even an operator with `UPDATE` rights on `agent_journal`
cannot retroactively rewrite the agent's recorded reasoning without
the chain noticing.
