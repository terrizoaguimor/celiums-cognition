# Skills

The corpus surface — curated technical knowledge the operator brings
to the gateway. Distinct from `memories` (which is personal) and from
`agent_journal` (which is reflective).

## The corpus

Bundled seed: 10,000 modules covering 10 pillars:

```
ai-ml · backend · cognitive-patterns · database · devops ·
epistemic-practices · frontend · human-ai-collaboration · mobile · security
```

Each module is a markdown body with metadata: name, display_name,
description, category, keywords, eval_score (0–10), line_count,
grounded (bool — has supporting references), and a 1024-dim TEI
embedding for vector search.

The seed is Apache-2.0 and ships with the plugin. Operators can
extend the corpus by writing to the `skills` table directly or by
pointing `KNOWLEDGE_API_URL` at an external corpus host.

## The three tools

### `forage(query, limit?)`

Hybrid search across the corpus. Composes:

1. FTS over `search_tsv` (PostgreSQL `tsvector`, English dictionary)
2. Cosine over `embedding` (1024-dim, Qdrant + pgvector HNSW)
3. Merges with weights `fts_rank * 0.4 + (1 - cosine_distance) * 0.6`

The vector path catches paraphrases the FTS misses; the FTS path
keeps exact-token matches authoritative. Returns ranked rows with
name, display_name, description, pillar, category, keywords,
eval_score, grounded, line_count. Optional similarity score when
querying semantic.

**When to call:** the user asks something that may have a curated
skill in the corpus (technical patterns, established practices,
debugging techniques). Distinct from `recall`: forage hits the
operator's knowledge base, `recall` hits personal memory. Use both
when the question spans both surfaces.

### `sense(name)`

Fetch the full body of a specific skill the user named explicitly.
Returns all metadata plus the markdown content. Use when you already
know the skill name; for "what's available", use forage.

### `map_network(seed)`

Walk the corpus graph from a seed skill, returning related skills
clustered by shared keywords + vector proximity. Useful for concept
maps, debugging thought drift, and finding links the user hasn't
drawn explicitly.

## The Skills tab

The dashboard's Skills tab:

- **Search bar** — defaults to FTS hybrid; toggle "Semantic" for the
  vector-first variant. Press `/` to focus. Press `⌘K` for the
  command palette (skills + actions).
- **Filters sidebar** — pick pillars (multi-select), min eval score,
  grounded-only.
- **Results** — paginated 50/page. Sort by relevance / eval score /
  line count / alphabetical.
- **Drawer** (click a row) — full content rendered as markdown +
  full metadata table + copy-as-system-prompt action.

## When the corpus disappoints

The seed corpus skews technical. If the user asks something that's
not in the corpus (e.g. "React Native performance profiling on
mobile" — currently no React-specific modules), `forage` will return
adjacents (cognitive-patterns, security). That's not a bug in
search; that's a gap in the corpus. The honest move: tell the user
the corpus doesn't cover that topic deeply, then either recall
personal memory or answer from training with a hedge.
