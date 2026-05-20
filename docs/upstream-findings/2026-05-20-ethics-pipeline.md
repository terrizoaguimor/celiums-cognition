# Ethics pipeline — upstream findings (2026-05-20)

Findings collected while hardening the ethics engine for `celiums-cognition`
Hard E2E on `prod-openclaw`. Each item names the file:line in the **vendored
upstream celiums-memory v2.0** and the temporary fix we applied locally in
this plugin. When upstream stabilises a new release, port these back.

Project: `celiums-memory` (upstream) → vendored at
`packages/engine/src/` in this repo.

Scope: this writeup is **architectural only**. No lexicon entries, no
adversarial-input strings, no harmful-content examples. The reproductions
referenced below were authored by Mario in a separate channel.

---

## 1. Layer K is FLAG-ONLY by design — cannot escalate `allow → block`

**Upstream**: `packages/core/src/ethics.ts` lines ~546–576 (the comment
explaining the redesign) + `packages/core/src/ethics-layer-k.ts`. The
`LayerKResult.decision` type was `'flag' | 'abstain'`.

**Symptom observed**: when Layer A's hardcoded lexicon misses a novel
threat surface (different wording for an already-curated concept), the
pipeline returns `allow` even when the OpenSearch corpus contains an
exact-concept match tagged `verdict=block, severity=critical`. Layer K
sees the match — it just isn't allowed to act on it.

**Why upstream took FLAG-ONLY**: rollback of an embedding-based
suppress-path that let real harm through (`incident 2026-05-17`). The
lesson was correct — *similarity alone* is not a safe signal. The
overcorrection is also real: once you have **curator-classified** verdict
and severity in the corpus row, similarity is one input among several
hard gates, and Layer K can safely act on it.

**Local fix** (this plugin only):
- Extended `LayerKResult.decision` to include `'escalate'`.
- `evaluateLayerK` in `packages/engine/src/ethics-layer-k.ts` now returns
  `escalate` when ALL of: Layer A silent, top match `verdict === 'block'`,
  `severity === 'critical'`, `similarity >= 0.75` (much stricter than
  the 0.55 advisory floor), and content does NOT invoke any 2-word
  fragment of any `legitimate_exception` of the match. Fail-closed.
- `evaluateFullPipeline` in `packages/engine/src/ethics.ts` consumes
  `decision === 'escalate'`: pushes a violation tagged
  `layerKEscalation`, sets `result.passed = false`, and refreshes
  `enforcementBlocked`.

**Recommendation for upstream**: the FLAG-ONLY redesign should stay
the default, but a `'escalate'` outcome guarded by the conjunctive
gates above is safe to introduce alongside it. The 2026-05-17 lesson is
preserved (similarity alone never decides; you need the curator's
verdict + severity AND no matching exception).

Commit applying the fix: `fae8d10`.

---

## 2. Layer C gate is too narrow — LLM never sees jailbreak surfaces

**Upstream**: `packages/core/src/ethics.ts` lines ~606–610 (the early-
return) and ~618–628 (the Layer C invocation gated on `layerB`).

**Symptom observed**: contextual jailbreaks (roleplay framing, fake
system-notes, dev-mode-claim) are LLM-detectable but lexicon-invisible.
When Layer A produces `arousal=0`, the pipeline's early return prevents
Layer B from running, which in turn prevents Layer C (the aiEvaluatorFn
LLM evaluator) from running. The LLM never sees substantive content
where it would have helped most.

**Local fix** (this plugin only):
- Derived `layerCEligible = !!aiEvaluatorFn && content.trim().length >= 30`
  as an alternative gate to `layerBEligible`.
- Changed the early-return to skip-deep-layers only when **both**
  `!layerBEligible && !layerCEligible`.
- Made the Layer C invocation `if (aiEvaluatorFn && (layerB || layerCEligible))`
  so Layer C can run with `layerB === null`.
- Pass `layerB?.justification || ''` (was `layerB.justification` —
  would have NPE'd when Layer B is null).
- When `layerC.aggregatedVerdict === 'forbid'` and nothing else
  blocked, escalate to block (`layerCEscalation: true`).
  Conservative: only `forbid`, never `concern`.

**Recommendation for upstream**: the Layer B early-return guard makes
sense when atlas/CVaR is the next step, but it shouldn't block Layer C
which has a different cost/value profile and can run with `layerA` alone.

Commit applying the fix: `fae8d10`. Layer C wiring (`aiEvaluatorFn`)
arrived earlier in commit `0344cc8`.

---

## 3. Corpus-lookup gate is too narrow — corpus never consulted when Layer A silent

**Upstream**: `packages/core/src/ethics.ts` lines ~522–530.

**Symptom observed**: same root cause as item 2. When Layer A's
hardcoded lexicon misses a threat surface, the gate
`(result.layerA.confidence >= 0.4 || layerABlocked)` prevents the
OpenSearch corpus from being consulted at all — Layer K never sees the
match because there's no match to see.

**Local fix** (this plugin only):
- Widened the gate to also fire when Layer A produced nothing actionable
  AND content is substantive (`>= 30` chars after trim).
- Cost: +1 hybrid OpenSearch query (~30–50ms) per eval where the lexicon
  was silent.

Commit applying the fix: `c20535d`.

---

## 4. `logEthicsAudit` has its pg INSERT commented out

**Upstream**: `packages/core/src/ethics-audit.ts` lines ~70–80.

**Symptom observed**: even when `logEthicsAudit` is invoked, the
function only writes to `console.error` (stdout / journalctl). The
`INSERT INTO ethics_audit (...)` is left as commented placeholder
intended to be wired against `./db.js` by the consumer. Audit table
stays empty for the lifetime of the deployment.

```ts
// Upstream code shape (paraphrased):
console.error(JSON.stringify({ type: 'ethics_audit', ...record }));
try {
  // const { pool } = await import('./db.js');
  // await pool.query('INSERT INTO ethics_audit (...) VALUES (...)', [...]);
} catch { /* best-effort */ }
```

**Recommendation for upstream**: keep the dynamic-import pattern, but
accept a pool via a parameter rather than asking each consumer to
maintain a `./db.js` file. Eg.:

```ts
export async function logEthicsAudit(
  content: string,
  auditEntry: AuditEntry,
  ...,
  pool?: { query: (sql: string, params?: any[]) => Promise<any> },
): Promise<void> { ... }
```

**Local approach** (this plugin only): rather than diverge `ethics-audit.ts`
from upstream, the persistence is wired at the **handler call site**
(`packages/engine/src/mcp/opencore-tools.ts handleEthicsTrace`). This
keeps the engine pipeline a pure function and lets the handler — which
already receives `ctx.pool` — be responsible for the DB side effect. See
item 5.

---

## 5. `logEthicsAudit` is only invoked in `mode === 'radar'`

**Upstream**: `packages/core/src/ethics.ts` lines ~722–725.

**Symptom observed**: even if item 4 were resolved, the audit hook
fires only in radar mode. `gate` mode (the default for most callers
including the ethics_trace MCP tool) never reaches the audit code.
Result: the most common path produces zero audit rows.

**Local fix** (this plugin only): the `ethics_trace` handler in
`packages/engine/src/mcp/opencore-tools.ts handleEthicsTrace` performs
the audit `INSERT` directly when (a) `ctx.pool` is available and (b) the
pipeline produced a block — independent of `mode`. This keeps audit
trail compact (block-only) and works in both modes. If `mode === 'radar'`
the in-engine call may still fire if upstream fixes item 4 — both are
idempotent at the row level (content_hash is part of the record).

**Recommendation for upstream**: invoke `logEthicsAudit` (or its
successor) unconditionally on a block, then optionally also in radar
mode for full-allow tracing. The two modes' audit policies are
orthogonal to whether a row should exist for a block.

Commit applying the fix: WIP at the time of writing.

---

## 6. Migrations are not bundled into the engine — must be supplied externally

**Upstream**: `packages/core/src/lib/migrations/runner.ts` and the
SQL files under `packages/core/scripts/migrations/`.

**Symptom observed**: the migrations runner exists and works, but the
`.sql` files are kept out of the npm package by the `files` whitelist
in upstream's `package.json`. Plugin builds that depend on the engine
have no way to obtain them other than vendoring.

**Local approach** (this plugin only): the migrations directory is
vendored alongside the engine source at
`packages/engine/scripts/migrations/`, and `packages/hard/`'s build
script copies them into `dist/migrations/` so the shipped plugin tarball
carries them. The adapter's `service.start` runs the migrations runner
against the configured `databaseUrl` after bootstrapping the local
stack — idempotent, drift-detected via per-file sha256.

**Recommendation for upstream**: add `scripts/migrations/` to the
package `files` whitelist, OR expose them via `import.meta` resolution
so consumers can pass the path to the runner without copying files
around.

Commit applying the fix: `b18c326` (vendor + bundle) and `d09844a`
(adapter wiring).

---

## 7. `forage` advertises hybrid search but only does FTS

**Upstream**: `packages/core/src/lib/pg-module-store.ts:searchFullText` +
`packages/core/src/lib/remote-module-store.ts:searchFullText` +
`packages/core/src/lib/opencore.ts:forage`.

**Symptom observed (2026-05-20, Mario's manual test)**: `forage` for
queries like *"ethics content moderation safety pipeline multi-layer
classification"* returned zero results even though the corpus had
exactly that concept indexed semantically. The tool's description
advertises hybrid (FTS + semantic) search, but the implementation:

```ts
// PgModuleStore.searchFullText (paraphrased)
const fts = await pool.query(`... WHERE search_tsv @@ websearch_to_tsquery('english', $1) ...`);
if (fts.rows.length > 0) return fts.rows.map(mapRow);
// fallback to ILIKE name/display_name trigram
return await pool.query(`... WHERE name ILIKE $1 OR display_name ILIKE $1 ...`);
```

— is **FTS over `search_tsv`** with an **ILIKE substring fallback**.
**No vector search anywhere**. The 1024-dim `skills.embedding` column
and its HNSW index are never consulted by `forage`. The
`ethics-knowledge-lookup` path that Layer K uses *does* hybrid against
OpenSearch (a different backend) — `forage` against the pg `skills`
table does not.

`websearch_to_tsquery` ANDs every term in the input, so a 6-word query
needs all 6 stems to appear in some row's `search_tsv` to score
non-zero. Paraphrases and conceptually-related rows are invisible.

**Local fix** (commit attached): added
`PgModuleStore.searchHybrid(query, queryEmbedding, limit)` which runs
both signals in parallel:

- FTS branch: `ts_rank(search_tsv, websearch_to_tsquery(...))` (existing)
- Vector branch: `1 - (embedding <=> $vec::vector)` ordered by the
  HNSW cosine index
- Merged via `FULL OUTER JOIN` on name, ranked by
  `0.4 * fts_score + 0.6 * vec_score`, breaks ties by `eval_score`.

`forage` now calls `searchHybrid` first, embedding the query via the
configured TEI server (`TEI_URL` env, defaults to `127.0.0.1:8080`
which is the bundled stack). On TEI failure or zero hybrid results, it
falls back to the upstream `searchFullText` behaviour — strict
superset, no regression.

`RemoteModuleStore.searchHybrid` exists for interface parity but
currently falls back to FTS until `memory.celiums.ai` exposes a hybrid
endpoint (recommend a `POST /v1/modules/search` accepting
`{query, embedding}`).

**Recommendation for upstream**:
- Adopt the same hybrid pattern in `pg-module-store.ts`.
- Expose a `POST /v1/modules/search` endpoint on `memory.celiums.ai`
  accepting `{query, embedding}` so `RemoteModuleStore` can also do
  hybrid when federated.
- Update the `forage` tool's description from "Hybrid (FTS + semantic)"
  to match reality, or fix the implementation; right now the
  description is aspirational.

---

## Summary

| Item | Severity | Local fix commit | Status |
|---|---|---|---|
| 1. Layer K cannot escalate | High (blind spots) | `fae8d10` | Local fix deployed; upstream recommendation pending |
| 2. Layer C gate too narrow | High (jailbreak miss) | `fae8d10` | Local fix deployed; upstream recommendation pending |
| 3. Corpus lookup gate too narrow | High (corpus dead-code when Layer A silent) | `c20535d` | Local fix deployed; upstream recommendation pending |
| 4. `logEthicsAudit` INSERT commented | Medium (no audit row) | n/a — bypassed | Local bypass via handler; upstream parameter-based pool injection recommended |
| 5. Audit hook only in radar mode | Medium (gate mode produces no rows) | `3115a9e` | Local fix via handler; upstream unconditional-on-block recommended |
| 6. Migrations not in npm package | Medium (consumer cannot run runner) | `b18c326` + `d09844a` | Local fix via vendor + bundle; upstream `files` whitelist add recommended |
| 7. `forage` is FTS-only despite hybrid advertising | High (semantic recall miss for paraphrased queries) | this commit | Local fix via `searchHybrid` + TEI embedding; upstream same pattern + remote endpoint recommended |

All fixes preserve the original 2026-05-17 redesign principle: *no
embedding similarity alone, no lexical heuristic alone, no LLM output
alone can flip the verdict — escalations require conjunctive curator-
classified evidence*.
