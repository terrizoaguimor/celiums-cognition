# Celiums Cognition

> Persistent emotional memory for OpenClaw agents. SHA-chained journal,
> multi-layer ethics gate, PAD + circadian limbic engine, hybrid memory
> retrieval, and ~60 cognitive tools — all wired into the agent's
> lifecycle by default.

---

## Enterprise-grade infrastructure, not a laptop plugin

Celiums Cognition runs a **four-container Docker stack** (Postgres +
pgvector, Qdrant, Valkey, OpenSearch), downloads ~110 MB of curated
corpora on first install, and holds ~1.5 GB of RAM steady-state. The
engine is deliberately heavy because every layer (ethics, journal,
limbic, hybrid retrieval) needs to run at agent speed — there is no
"lite mode" by design.

**Designed for:**

- **VPS hosts** dedicated to running OpenClaw (≥ 4 GB RAM, ≥ 2 vCPU,
  Linux + Docker)
- **Mac minis** and headless workstations driving an agent fleet
- **Enterprise OpenClaw deployments** (such as Celiums AI) where the
  gateway is managed end-to-end by agents and sub-agents — not by a
  human typing at the terminal

If you're running OpenClaw on a laptop with minimum specs, or for
one-off experimentation, use the bundled `memory-core` (file-based,
zero infra) or the official `memory-lancedb` extension instead. Both
ship with OpenClaw and don't need Docker.

---

```
openclaw plugins install clawhub:@celiumsai/cognition
```

That's the entire install. On first start, the plugin auto-bootstraps
a four-container stack (Postgres + Qdrant + Valkey + OpenSearch) via
Docker, mints a unique database password (chmod 600), applies the
engine migrations, downloads the curated **10K-skills seed** (SHA-256
verified) into Postgres, and bulk-indexes the **ethics corpus**
(~1857 docs, 1024-dim embeddings, SHA-256 verified) into OpenSearch.
By the time the gateway reports ready, every layer of the plugin is
populated. No manual setup step, no SaaS, no required keys.

---

## What it does, layer by layer

| Surface | What the agent gains |
|---|---|
| **Auto-recall** | Every prompt is enriched with relevant memories, the agent's identity preamble, subagent briefings (when applicable), and a structured turn_context. Cache-stable, ~3000-char budget. |
| **Auto-capture** | The user's last message at every agent turn end is stored as a memory with importance scoring + PAD analysis. |
| **Auto-journal** | Every meaningful turn writes a first-person SHA-256-chained journal entry: decision / reflection / lesson / belief / arc / doubt. Tamper-evident, hash-verified, agent-scoped. |
| **Ethics gate** | Five-layer pipeline (lexicon → CVaR → multi-framework LLM → corpus-grounded → audit) runs before every prompt and tool call. Block decisions carry category + source + audit trail. |
| **Subagent lineage** | The plugin observes `subagent_spawning/spawned/ended`, builds a parent ↔ child tree, briefs children with relevant parent journal entries, refuses cycles past depth 3. |
| **Session boundaries** | `session_start` / `session_end` write anchor entries with deterministic summaries (reason, duration, message count, journal counts). Resumed sessions carry a `resumed-from:<id>` tag. |
| **Compaction continuity** | When the context window rotates, the plugin persists high-value facts as memories AND writes an `arc` journal entry so the next turn can pick up the thread. |
| **Operator dashboard** | React SPA at `/plugins/celiums-cognition/` shows live PAD + circadian, agent state, journal hash chain, memory search, ethics audit log, subagent lineage tree. |
| **Operator actions** | Five inline slash commands (`celiums.remember`, `.recall`, `.limbic`, `.forget`, `.status`). The destructive ones (`forget`) require a typed two-press confirmation with mandatory reason. |
| **Channel mailbox** | `POST /api/celiums-cognition/inbox/inject` enqueues a note that the target session sees at the top of its next turn. External plugins (Telegram, Slack, email) push through here; nothing flows directly into UI state. |
| **Governance** | Every block decision propagates to the gateway's central security-audit log as a `SecurityAuditFinding`. Tool registrations carry group + risk metadata (memory / journal / ethics / cognitive / atlas / research / write × low | medium | high). |
| **Heartbeat snapshot** | Proactive ticks see a state snapshot (memory count, open subagents, ethics mode, last journal hash) — never a fabricated result. |

Every line above is a wired SDK seam on the OpenClaw 2026.5+ runtime,
not a hypothetical capability. See `docs/transversal-roadmap.md` for
the design rationale behind each piece and `docs/celiums-cognition-doctrine.md`
for the 40 principles that shape the implementation.

---

## Quickstart

```bash
# 1. Install (in your gateway)
openclaw plugins install clawhub:@celiumsai/cognition

# 2. Verify the stack is up
curl -s http://localhost:18789/api/celiums-cognition/health | jq .stack
# postgres: ok | qdrant: ok | valkey: ok | opensearch: ok (ethics_corpus_docs ~1857) | tei: ok

# 3. Open the dashboard
open http://localhost:18789/plugins/celiums-cognition/
# Sign up (first user becomes the operator), then explore Overview,
# Memories, Journal, Skills, Ethics, Settings.
```

Concrete walkthroughs for the most-asked flows live under
[`docs/examples/`](./docs/examples/):

- [`auto-recall.md`](./docs/examples/auto-recall.md) — what the agent
  actually sees in its system prompt on every turn
- [`ethics-block.md`](./docs/examples/ethics-block.md) — how the
  five-layer gate decides
- [`subagent-lineage.md`](./docs/examples/subagent-lineage.md) — the
  parent ↔ child tree, briefings, and retrospective journal entries
- [`journal-hash-chain.md`](./docs/examples/journal-hash-chain.md) —
  verifying the SHA chain after the fact

---

## Configuration

The plugin honours these env vars at start (all optional):

| Env | Default | Purpose |
|---|---|---|
| `CELIUMS_DATABASE_URL` | derived from `~/.celiums-cognition/credentials.env` | Postgres connection URL |
| `CELIUMS_QDRANT_URL` | `http://localhost:6333` | Qdrant HTTP endpoint |
| `CELIUMS_VALKEY_URL` | `redis://localhost:6379` | Valkey / Redis cache |
| `OPENSEARCH_URL` | `http://127.0.0.1:9200` | Ethics-corpus index host |
| `ETHICS_INDEX` | `ethics_knowledge` | OpenSearch index name |
| `TEI_URL` | `http://localhost:8080` | Text-Embeddings-Inference |
| `CELIUMS_EMBEDDING_DIM` | `1024` | Must match TEI output |
| `CELIUMS_SEED_URL` | `https://celiums-seed-public.nyc3.digitaloceanspaces.com/seed` | Skills seed manifest + tarball base URL |
| `CELIUMS_SEED_VERSION` | `v1` | Skills seed version label |
| `CELIUMS_SEED_SKIP` | unset | Set `true` to skip the skills seed (`forage` returns empty until populated) |
| `CELIUMS_ETHICS_CORPUS_URL` | celiums-memory v2.0.0 GitHub release asset | Ethics corpus jsonl |
| `CELIUMS_ETHICS_CORPUS_SHA256` | known sha of the v2.0.0 asset | Tamper protection |
| `CELIUMS_ETHICS_CORPUS_SKIP` | unset | Set `true` to skip the ethics corpus load (Layer D abstains) |
| `CELIUMS_TRUST_PROXY_HEADERS` | unset | Set `true` only when the gateway sits behind a reverse proxy you control |
| `TZ` | host's `/etc/timezone` | Container + process timezone |

Per-plugin config (`openclaw.json`) accepts `userId`, `agentId`,
`exposedTools` (`curated` | `all`), and the toggles for
`ethics.enabled`, `ethics.strictMode`, `autoRecall.enabled`,
`autoCapture.enabled`, `journal.autoWrite.enabled`. The full schema is
declared in `packages/shared/src/config-schema/index.ts`.

---

## Monorepo layout

```
packages/engine   @celiumsai/cognition-engine  (private — vendored Celiums Memory v2.0)
packages/shared   @celiumsai/cognition-shared  (private — plugin adapter + HTTP routes)
packages/hard     @celiumsai/cognition         (publishable)
```

The `shared` adapter is partitioned by domain after the A1 split:
`plugin-adapter/hooks/*` for SDK lifecycle hooks, `wiring/*` for
register-style integrations, `routes/*` for HTTP endpoints. Every file
sits under 300 LOC. The `context.ts` module owns the shared closure
surface (readiness gate, lazy engine init, throttles, refs).

---

## Status

Pre-1.0 — feature-complete against the six transversal phases (A
continuity, B subagents, C session lifecycle, D operator UX, E
governance, F autonomy + channels), audit-hardened, and running in
production on a single-tenant gateway. The publish track (npm +
ClawHub) is gated on an explicit go-ahead. See
[`docs/transversal-roadmap.md`](./docs/transversal-roadmap.md) for
the current phase map.

---

## License

Apache-2.0 © Celiums Solutions LLC. See [LICENSE](./LICENSE) and
[NOTICE](./NOTICE). The engine vendors `celiums-memory v2.0`
([github.com/terrizoaguimor/celiums-memory](https://github.com/terrizoaguimor/celiums-memory),
Apache-2.0); each vendored file carries the canonical NOTICE header.
