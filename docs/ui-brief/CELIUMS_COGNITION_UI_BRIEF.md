# Celiums Cognition — UI Design Brief

**Audience**: Claude design (or any visual designer) producing the UI for the
OpenClaw plugin "Celiums Cognition".
**Scope (Fase 1)**: Overview tab + Skills tab with semantic search. Other
tabs (Memories, Journal, Ethics, Settings) come in later phases — but the
visual system should anticipate them.
**Constraint**: this UI is served by the plugin itself (HTTP routes from
the gateway), accessed in a browser tab at
`http://<openclaw-gateway-host>:18789/plugins/celiums-cognition/`.

---

## 1. Context — what is Celiums Cognition?

OpenClaw is a multi-channel agent platform (chat / WhatsApp / Telegram /
etc.) running locally (`openclaw-gateway` daemon). Operators install
plugins to extend it.

**Celiums Cognition** is the "memory + ethics + knowledge" plugin: it
gives the agent a Postgres-backed cognitive engine — persistent emotional
memory, journal hash-chain, multi-layer ethics pipeline (lexicon +
probabilistic CVaR + LLM-multi-framework + corpus-grounded escalation),
and a 10,000-skill knowledge corpus (the free seed). The full corpus is
600k+ modules behind a paid Celiums SaaS tier.

**Problem the UI solves**: today the plugin is a "mystery box" once
installed. Operator can `openclaw plugins inspect celiums-cognition` and
see "loaded", but can't tell if the docker stack is healthy, what's in
the corpus, what the agent has remembered, what ethics decisions
happened, or whether a newer version exists.

**Goal of this UI**: turn the mystery box into an observable, browsable,
queryable surface. Match OpenClaw's existing aesthetic (dark theme,
sidebar-driven, dense data). Be the "wow" demo when someone runs the
install for the first time.

---

## 2. Visual identity & aesthetic

### Match OpenClaw

The plugin is part of the OpenClaw experience. The screenshot the user
provided shows OpenClaw's control UI:

- **Dark theme**, near-black background (`#0a0a0a`-ish), brand red accent
  (OpenClaw's red `#dc1f1f`-ish).
- Sidebar with section headers (uppercase, dim gray), nested items.
- Selected item has a subtle red left-border + soft red background tint.
- Status dots (small colored circles) for live state — green = healthy,
  red = error, gray = idle.
- Typography: sans-serif (looks like Inter or similar), tight, slightly
  condensed.
- Version footer pinned at bottom.

### Celiums identity

- Brand color: Celiums uses a **purple/violet** family (`#7c3aed`-ish)
  in its own marketing. Use violet as the secondary accent for
  Celiums-Cognition-specific elements (highlights, badges, primary CTA)
  to differentiate from OpenClaw's red. But the chrome (background,
  borders, text) should match OpenClaw exactly so the plugin feels
  native.
- Logo: a small `🧠` glyph or a custom mark works for the page title.

### Density vs. breathing room

OpenClaw is dense. Match that. Plugin operators want to see lots of
data without scrolling. Use compact rows, smaller font for body
(`13-14px`), inline metadata.

---

## 3. Layout — top-level structure

```
┌─ Browser tab title: "Celiums Cognition · OpenClaw" ─────────────────┐
│                                                                      │
│  ┌─ Local sidebar (220px) ─┐  ┌─ Main panel (rest) ─────────────┐   │
│  │ 🧠 Celiums Cognition    │  │                                  │   │
│  │ ────                    │  │   <route content here>           │   │
│  │ 📦 Overview     [ • ]   │  │                                  │   │
│  │ 📚 Skills       10k     │  │                                  │   │
│  │ 🧠 Memories     n       │  │                                  │   │
│  │ 📓 Journal      n       │  │                                  │   │
│  │ ⚖️  Ethics      n       │  │                                  │   │
│  │ ⚙️  Settings            │  │                                  │   │
│  │                         │  │                                  │   │
│  │ ━━━                     │  │                                  │   │
│  │ Plugin v0.1.0           │  │                                  │   │
│  │ ● healthy               │  │                                  │   │
│  └─────────────────────────┘  └──────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

- The page is **single-page application** with client-side routing.
  Each sidebar item is a route. No full page reloads.
- The local sidebar is INSIDE the page chrome — the user has already
  navigated TO the plugin in their browser. We don't replicate the
  full OpenClaw sidebar; we only show the plugin's own tabs.
- The number next to each tab is the row count (e.g. "10k" for Skills).
- The footer shows plugin version + a status dot (green = stack
  healthy, red = some component down).

Responsive: target desktop primary. If viewport < 900px, collapse
the sidebar to a top bar of pill tabs.

---

## 4. Tab 1 — Overview (the landing page)

Default route when the user opens the plugin URL. Goal: tell them at a
glance "everything is working" or "X is broken".

### Sections (top → bottom)

#### 4.1 Stack health card

```
┌─ Stack ─────────────────────────────────────────┐
│  Postgres   ● healthy   127.0.0.1:5432   24 MB  │
│  Qdrant     ● healthy   127.0.0.1:6333    8 MB  │
│  Valkey     ● healthy   127.0.0.1:6379    1 MB  │
│  TEI        ● healthy   127.0.0.1:8080  gte-large-en-v1.5 │
└──────────────────────────────────────────────────┘
```

- Live polled (every 5s, but only when this tab is visible).
- Status dot uses the same green / red / amber semantic as OpenClaw.
- Show endpoint + brief identity (db name, model id).

#### 4.2 Counts (corpus + activity)

```
┌─ Corpus ──────────────┐  ┌─ Activity (24h) ──────────┐
│  Skills      10,000   │  │  Memories captured      4 │
│  Memories       12    │  │  Journal entries        7 │
│  Journal        9     │  │  Ethics blocks          3 │
│  Ethics events  3     │  │  Ethics flags           1 │
└───────────────────────┘  └────────────────────────────┘
```

- Two side-by-side cards.
- Total counts (left) vs. last-24h activity (right).
- Hover a number → small tooltip with breakdown by pillar/agent/etc.

#### 4.3 Plugin metadata + update check

```
┌─ Plugin ────────────────────────────────────────┐
│  Version       0.1.0                            │
│  Edition       Hard (Postgres + Qdrant + Valkey)│
│  Seed          v1 (Apache-2.0, 10k modules)     │
│  Installed     2026-05-19 17:55 (1d 19h ago)    │
│                                                  │
│  ◯ Check for updates    [latest is v0.1.0]      │
└──────────────────────────────────────────────────┘
```

- "Check for updates" is a click action — fetches the manifest from
  ClawHub (or a release URL) and reports current vs. latest. If
  newer is available, the button morphs into "Install v0.X.Y".

#### 4.4 Recent activity timeline (optional Fase 1, def Fase 2)

A scrollable list of "what just happened" — last 20 events across
memories captured, journal entries, ethics blocks. Each row: timestamp,
event type icon, one-line summary.

### Empty states

If a component is down, show the same card but `● error` plus an
action ("View logs" → external command suggestion, can't actually
fetch logs from the UI for security reasons). Don't crash the page.

---

## 5. Tab 2 — Skills (corpus browse + semantic search)

The "wow" demo. The free seed has 10,000 curated skills across 10
pillars, each with an embedding. User can text-search OR semantic-search
and browse by pillar/category.

### Layout

```
┌─ Skills (10,000) ─────────────────────────────────────────────────┐
│                                                                    │
│  [🔍 Search skills...                            ] [⚡ Semantic ◯] │
│                                                                    │
│  ┌─ Filters ─────────┐  ┌─ Results (10,000) ─────────────────┐    │
│  │ Pillar            │  │                                     │    │
│  │ ☑ ai-ml      1000 │  │  ┌─ Result card ────────────────┐  │    │
│  │ ☑ backend    1000 │  │  │  📘 React Native Performance │  │    │
│  │ ☑ frontend   1000 │  │  │     Profiling: Bridge...      │  │    │
│  │ ☑ devops     1000 │  │  │  pillar: mobile · category:  │  │    │
│  │ ...               │  │  │  mobile-development          │  │    │
│  │                   │  │  │  eval: 10.0  ·  879 lines    │  │    │
│  │ Category          │  │  │  similarity: 0.87            │  │    │
│  │ ☐ (any)           │  │  │  [keywords] [keywords]       │  │    │
│  │                   │  │  └───────────────────────────────┘  │    │
│  │ Quality           │  │                                     │    │
│  │ Min eval [ 8.0 ▾] │  │  ┌─ Result card ────────────────┐  │    │
│  │ ☐ Grounded only   │  │  │  ...                          │  │    │
│  │                   │  │  └───────────────────────────────┘  │    │
│  │  [Reset]          │  │                                     │    │
│  └───────────────────┘  │  Loading more... / Showing 50/N    │    │
│                          └─────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

### Search

- **Default**: text search (FTS). Fast.
- **Toggle "Semantic"**: switches to vector embedding (HNSW). The
  toggle should clearly indicate "this uses gte-large-en-v1.5 to find
  conceptually-related results, not just text matches". A small `?`
  tooltip.
- Combined: when both checkbox-on plus FTS query, run hybrid (both,
  re-ranked).
- Debounce input: 250ms.
- Show "similarity: 0.87" badge on each result when semantic is on.

### Filters

- Pillar (checkboxes, the 10 pillars, with counts).
- Category (dropdown, depends on selected pillars — load on demand).
- Min eval score (numeric slider 0.0–10.0).
- Toggle "grounded only".

### Result card

A skill is identified by `name` (a slug PK) and has `display_name`
(human title), `description`, `category`, `pillar`, `keywords[]`,
`content` (the full skill body — long markdown), `line_count`,
`eval_score`, `eval_verdict`, `grounded`.

Card shows:
- icon (📘 default; could vary by category)
- `display_name` as title (bold, larger)
- `description` truncated to ~2 lines (full on click)
- `pillar · category` meta
- `eval: X.X · N lines` chips
- `similarity: 0.XX` badge when semantic
- first 3-5 keywords as tags

Clicking a card opens a **detail drawer** (right-side, slide-in) with:
- full display_name + name
- full description
- full content rendered as markdown
- all metadata: eval_verdict, source_count, grounded, created_at, etc.
- "Copy as system prompt" CTA (copy the content to clipboard, framed
  as a prompt the agent could use)
- Close button (X)

### Empty state

When skills count is 0 (e.g. seed didn't download): show a friendly
message "No skills loaded yet" with instructions: "Set CELIUMS_SEED_URL
or federate to memory.celiums.ai with KNOWLEDGE_API_URL". Link to docs.

### Loading states

- Search debouncing → small spinner inline.
- Initial filter load → skeleton rows in the result panel.
- Detail drawer → skeleton on the right while content fetches.

---

## 6. Component inventory

### Reusable

- **StatusDot**: small circle, color = green/red/amber/gray, optional
  pulse animation for "live polling".
- **MetricCard**: title + big number + optional sparkline.
- **DataChip**: small inline badge for metadata (eval score, line
  count, similarity). Different colors for different kinds.
- **TagBadge**: keyword pill.
- **SectionHeader**: uppercase dim gray, with optional count chip.
- **Drawer**: right-side slide-in for detail views.
- **EmptyState**: icon + heading + body + CTA.
- **Toast**: bottom-right transient message (for "Copied!", errors).

### Layout primitives

- **Sidebar**: 220px fixed, items have icon + label + optional count.
- **MainPanel**: scrollable, padded `24px`.
- **Card**: rounded `8px`, subtle border `1px solid rgba(255,255,255,0.06)`,
  background `rgba(255,255,255,0.02)`, padding `16px`.

---

## 7. API contracts — data the UI consumes

The plugin exposes these HTTP routes (all under
`/api/celiums-cognition/*`, served by `api.registerHttpRoute()` from
the plugin):

### `GET /api/celiums-cognition/health`

```json
{
  "version": "0.1.0",
  "edition": "hard",
  "installed_at": "2026-05-19T17:55:41Z",
  "stack": {
    "postgres": { "ok": true, "endpoint": "127.0.0.1:5432", "db": "celiums_memory", "size_bytes": 25165824 },
    "qdrant":   { "ok": true, "endpoint": "127.0.0.1:6333" },
    "valkey":   { "ok": true, "endpoint": "127.0.0.1:6379" },
    "tei":      { "ok": true, "endpoint": "127.0.0.1:8080", "model": "Alibaba-NLP/gte-large-en-v1.5" }
  },
  "seed": { "version": "v1", "applied_at": "2026-05-20T17:29:25Z", "row_count": 10000 }
}
```

### `GET /api/celiums-cognition/counts`

```json
{
  "skills": 10000,
  "memories": 12,
  "journal_entries": 9,
  "ethics_events": 3,
  "activity_24h": {
    "memories_captured": 4,
    "journal_entries": 7,
    "ethics_blocks": 3,
    "ethics_flags": 1
  }
}
```

### `GET /api/celiums-cognition/skills`

Query params:
- `q` — search query (text)
- `semantic` — `true` to use HNSW vector search instead of FTS
- `pillar` — repeatable, filter by pillar(s)
- `category` — single category filter
- `min_eval` — minimum eval_score
- `grounded` — `true` to filter to grounded only
- `limit` — default 50, max 200
- `offset` — for pagination

Response:
```json
{
  "total": 10000,
  "results": [
    {
      "name": "react-native-performance-profiling",
      "display_name": "React Native Performance Profiling: Bridge Bottlenecks, Hermes, and Native Modules",
      "description": "Voice agent development is inherently volatile...",
      "pillar": "mobile",
      "category": "mobile-development",
      "keywords": ["react-native", "performance", "hermes", "bridge"],
      "eval_score": 10.0,
      "eval_verdict": "accept",
      "line_count": 879,
      "grounded": false,
      "similarity": 0.87
    }
  ]
}
```

`similarity` field is only present when `semantic=true`.

### `GET /api/celiums-cognition/skills/:name`

Returns full row including `content` (the markdown body, can be long).

### `GET /api/celiums-cognition/pillars`

Returns the pillar list + counts (for filter sidebar):
```json
{
  "pillars": [
    { "name": "ai-ml", "count": 1000 },
    { "name": "backend", "count": 1000 },
    ...
  ]
}
```

### `GET /api/celiums-cognition/version-check`

```json
{
  "current": "0.1.0",
  "latest": "0.1.0",
  "update_available": false
}
```

---

## 8. Accessibility & UX details

- Keyboard navigation: tab order should follow visual order. `/` focuses
  the search input. `Esc` closes drawers.
- Focus rings visible (subtle violet outline on focused elements).
- Color contrast: AA minimum. Dark theme means lighter text on dark
  background — check that "dim gray" labels still pass contrast.
- Loading: never block the whole page; always have skeleton states.
- Errors: never alert/popup; show inline at the top of the affected
  panel with retry CTA.

---

## 9. Out of scope (Fase 1)

These come later — don't design for them now, but the layout should
accommodate adding sidebar entries without restructuring:

- Memories tab (browse + semantic search of `memories` table)
- Journal tab (timeline of `agent_journal`, hash-chain verification)
- Ethics tab (audit trail of `ethics_audit`, filterable by decision)
- Settings tab (env-var editor for `CELIUMS_*`, plugin config)

---

## 10. Deliverables I'd love from Claude design

1. **Tailwind config** (or design tokens JSON) defining the colors,
   spacing, radii, fonts. Match the OpenClaw aesthetic + Celiums
   violet accent.
2. **Component library** (Svelte preferred, but React if you want)
   for the reusable components in §6. Each as a standalone `.svelte`
   (or `.tsx`) file.
3. **The two pages** (`Overview.svelte`, `Skills.svelte`) using those
   components, with mocked data inline. The mocked data shape MUST
   match §7 so I can wire the real API later by swapping the data
   source.
4. **`index.html` + entry**: a single static HTML the plugin can serve,
   with the Svelte/React bundle inlined or referenced. If you produce
   a Vite `dist/`, that's perfect — I'll bundle it into the plugin
   under `dist/ui/`.

Stack preference: **Svelte 5 + Vite + TailwindCSS 4** (smallest bundle).
But if you prefer React, that's fine too — just keep the bundle <
300KB gzipped.

---

## 11. Notes for the integrator (me, after design lands)

When the design assets arrive, my job is:

1. Place the bundle under `packages/hard/src/ui/dist/` (or wherever).
2. Wire `packages/hard/src/index.ts` to register HTTP routes:
   - One GET that serves `index.html`
   - One GET pattern for `/assets/*` serving the bundle
   - The `/api/*` routes implementing the endpoints in §7
3. Hook the API handlers up to `ctx.pool` (already wired in the
   adapter) for skills/memories/journal/ethics queries, and to
   the SeedManager state for version info.
4. The semantic search route calls TEI to embed the query, then
   does a `<=>` cosine distance query against `skills.embedding`
   (HNSW index already exists from migration 012).

I'll mock the API responses inline in the Svelte components first
(matching §7 shapes), then swap to real fetch later.
