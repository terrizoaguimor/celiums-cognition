/* Mock data matching API contracts from §7 of the brief. */

export const MOCK_HEALTH = {
  version: "0.1.0",
  edition: "hard",
  installed_at: "2026-05-19T17:55:41Z",
  stack: {
    postgres: { ok: true,  endpoint: "127.0.0.1:5432", db: "celiums_memory", size_bytes: 25165824 },
    qdrant:   { ok: true,  endpoint: "127.0.0.1:6333", size_bytes: 8388608 },
    valkey:   { ok: true,  endpoint: "127.0.0.1:6379", size_bytes: 1048576 },
    tei:      { ok: true,  endpoint: "127.0.0.1:8080", model: "gte-large-en-v1.5" },
  },
  seed: { version: "v1", applied_at: "2026-05-20T17:29:25Z", row_count: 10000 },
};

export const MOCK_COUNTS = {
  skills: 10000,
  memories: 1247,
  journal_entries: 847,
  ethics_events: 103,
  activity_24h: {
    memories_captured: 12,
    journal_entries: 7,
    ethics_blocks: 3,
    ethics_flags: 2,
  },
};

export const PILLARS = [
  { name: "ai-ml",         count: 1000, color: "#a78bfa" },
  { name: "backend",       count: 1000, color: "#60a5fa" },
  { name: "frontend",      count: 1000, color: "#34d399" },
  { name: "mobile",        count: 1000, color: "#f472b6" },
  { name: "devops",        count: 1000, color: "#fbbf24" },
  { name: "data",          count: 1000, color: "#22d3ee" },
  { name: "security",      count: 1000, color: "#fb7185" },
  { name: "product",       count: 1000, color: "#c4b5fd" },
  { name: "research",      count: 1000, color: "#86efac" },
  { name: "infrastructure",count: 1000, color: "#fdba74" },
];

export const PILLAR_ICONS = {
  "ai-ml": "🧠",
  "backend": "⚙",
  "frontend": "◐",
  "mobile": "▢",
  "devops": "⎈",
  "data": "≋",
  "security": "⛨",
  "product": "✦",
  "research": "⌬",
  "infrastructure": "⚒",
};

/* 24 realistic skills sampled across pillars. */
export const MOCK_SKILLS = [
  {
    name: "react-native-performance-profiling",
    display_name: "React Native Performance Profiling: Bridge Bottlenecks, Hermes, and Native Modules",
    description: "Methodically profile the JS-to-native bridge using Flipper and Hermes inspectors. Identify serialization overhead on dispatch-heavy screens, swap chatty modules for TurboModules, and validate with on-device traces before shipping.",
    pillar: "mobile",
    category: "mobile-development",
    keywords: ["react-native", "performance", "hermes", "bridge", "turbomodules"],
    eval_score: 10.0,
    eval_verdict: "accept",
    line_count: 879,
    grounded: true,
    similarity: 0.87,
  },
  {
    name: "postgres-query-planner-deep-dive",
    display_name: "Postgres Query Planner Deep Dive: Reading EXPLAIN ANALYZE Like a Surgeon",
    description: "Move beyond `EXPLAIN` cargo-culting. Decode bitmap heap scans, nested loop traps, and stale `pg_stats`. Includes a decision tree for when to force a plan with pg_hint_plan and when to fix statistics instead.",
    pillar: "backend",
    category: "databases",
    keywords: ["postgres", "query-planner", "explain", "performance"],
    eval_score: 9.6,
    eval_verdict: "accept",
    line_count: 1142,
    grounded: true,
    similarity: 0.83,
  },
  {
    name: "vector-search-hnsw-tuning",
    display_name: "HNSW Index Tuning for Production Vector Search",
    description: "Pick `m`, `ef_construction`, and `ef_search` for your dataset size and recall target. Includes a calibration script that sweeps parameters and emits a Pareto plot of recall vs. p99 latency.",
    pillar: "ai-ml",
    category: "vector-databases",
    keywords: ["hnsw", "vector-search", "embeddings", "pgvector", "qdrant"],
    eval_score: 9.8,
    eval_verdict: "accept",
    line_count: 624,
    grounded: true,
    similarity: 0.92,
  },
  {
    name: "kafka-exactly-once-semantics",
    display_name: "Exactly-Once Semantics in Kafka: The Three Settings That Actually Matter",
    description: "Idempotent producers + transactional reads + `read_committed` isolation. Walks through the failure modes each setting prevents and the ones it doesn't (hint: it doesn't prevent application bugs).",
    pillar: "backend",
    category: "event-streaming",
    keywords: ["kafka", "streaming", "transactions", "exactly-once"],
    eval_score: 9.2,
    eval_verdict: "accept",
    line_count: 712,
    grounded: false,
    similarity: 0.78,
  },
  {
    name: "css-container-queries-vs-media",
    display_name: "Container Queries vs. Media Queries: When to Use Which",
    description: "Container queries shine for reusable components dropped into unknown contexts. Media queries still win for page-level layout. Decision matrix included.",
    pillar: "frontend",
    category: "css",
    keywords: ["css", "container-queries", "responsive", "layout"],
    eval_score: 8.9,
    eval_verdict: "accept",
    line_count: 412,
    grounded: false,
    similarity: 0.74,
  },
  {
    name: "kubernetes-pod-disruption-budgets",
    display_name: "Pod Disruption Budgets: Surviving Voluntary Eviction Cascades",
    description: "PDBs are necessary but not sufficient. Combine with `topologySpreadConstraints`, `terminationGracePeriodSeconds`, and a pre-stop hook to drain in-flight requests during cluster upgrades.",
    pillar: "devops",
    category: "kubernetes",
    keywords: ["kubernetes", "pdb", "high-availability", "draining"],
    eval_score: 9.4,
    eval_verdict: "accept",
    line_count: 538,
    grounded: true,
    similarity: 0.69,
  },
  {
    name: "transformer-attention-mechanics",
    display_name: "Self-Attention from First Principles: Q, K, V, and Why Scaling Matters",
    description: "Derive scaled dot-product attention by hand. Explain why dividing by √d_k preserves gradient magnitude as model width scales. Builds intuition for multi-head as parallel feature detectors.",
    pillar: "ai-ml",
    category: "deep-learning",
    keywords: ["transformers", "attention", "deep-learning", "fundamentals"],
    eval_score: 9.9,
    eval_verdict: "accept",
    line_count: 893,
    grounded: true,
    similarity: 0.90,
  },
  {
    name: "tls-handshake-anatomy",
    display_name: "TLS 1.3 Handshake Anatomy: From ClientHello to Application Data",
    description: "Walk every byte of a TLS 1.3 handshake. Includes pcap captures and a teaching client in 200 lines of Python that prints each record as it parses it.",
    pillar: "security",
    category: "cryptography",
    keywords: ["tls", "cryptography", "handshake", "networking"],
    eval_score: 9.5,
    eval_verdict: "accept",
    line_count: 1023,
    grounded: true,
    similarity: 0.64,
  },
  {
    name: "feature-flag-lifecycle",
    display_name: "Feature Flag Lifecycle: Birth, Adolescence, Cleanup",
    description: "Flags rot. They become permanent dependencies, then production-critical, then load-bearing surprises. Run a flag-debt review every quarter; this is what to look for.",
    pillar: "product",
    category: "delivery",
    keywords: ["feature-flags", "experimentation", "tech-debt"],
    eval_score: 8.6,
    eval_verdict: "accept",
    line_count: 384,
    grounded: false,
    similarity: 0.58,
  },
  {
    name: "rust-async-mental-model",
    display_name: "Rust async/await: The Reactor, the Executor, and Your `Future`",
    description: "Why `.await` doesn't spawn a thread. How Tokio's reactor uses epoll/kqueue/IOCP under the hood. When you actually need `spawn_blocking` vs. just an async wrapper.",
    pillar: "backend",
    category: "languages",
    keywords: ["rust", "async", "tokio", "concurrency"],
    eval_score: 9.7,
    eval_verdict: "accept",
    line_count: 945,
    grounded: true,
    similarity: 0.81,
  },
  {
    name: "prompt-injection-defenses",
    display_name: "Prompt Injection Defenses for LLM Agents: A Layered Approach",
    description: "Input filtering catches the easy cases. Spotlighting helps a bit. The real defense is constraining what the model is *allowed* to do — tool whitelists, output schemas, and human approval on side-effects.",
    pillar: "security",
    category: "llm-security",
    keywords: ["prompt-injection", "llm", "agents", "security"],
    eval_score: 9.3,
    eval_verdict: "accept",
    line_count: 678,
    grounded: true,
    similarity: 0.88,
  },
  {
    name: "embeddings-dimensionality-tradeoffs",
    display_name: "Embedding Dimensionality: Storage, Recall, and the 384/768/1024 Decision",
    description: "Smaller embeddings are faster and cheaper. Matryoshka models let you truncate without retraining. When to use 384d for retrieval and 1024d for re-ranking.",
    pillar: "ai-ml",
    category: "embeddings",
    keywords: ["embeddings", "matryoshka", "retrieval", "rerank"],
    eval_score: 9.1,
    eval_verdict: "accept",
    line_count: 512,
    grounded: false,
    similarity: 0.85,
  },
  {
    name: "ios-background-fetch-realities",
    display_name: "iOS Background Fetch: What the System Will Actually Run",
    description: "The OS owns your background time budget. `BGAppRefreshTask` runs when the system decides. Coalesce work, expect to be killed, and design for partial progress.",
    pillar: "mobile",
    category: "ios",
    keywords: ["ios", "background-fetch", "bgtaskscheduler"],
    eval_score: 8.8,
    eval_verdict: "accept",
    line_count: 466,
    grounded: false,
    similarity: 0.55,
  },
  {
    name: "data-contract-versioning",
    display_name: "Data Contract Versioning Between Producer and Consumer Teams",
    description: "Schema registry isn't enough. Define backward/forward compat policy, add deprecation windows, and gate breaking changes behind a contract review with downstream owners.",
    pillar: "data",
    category: "data-engineering",
    keywords: ["data-contracts", "schema-registry", "governance"],
    eval_score: 9.0,
    eval_verdict: "accept",
    line_count: 587,
    grounded: true,
    similarity: 0.62,
  },
  {
    name: "graphql-n-plus-one-dataloader",
    display_name: "Solving GraphQL N+1 with DataLoader (and When You Shouldn't)",
    description: "DataLoader batches inside a request lifecycle. It doesn't help across requests or at the edge. For chatty schemas, push joins into the persistence layer instead.",
    pillar: "backend",
    category: "graphql",
    keywords: ["graphql", "n+1", "dataloader", "batching"],
    eval_score: 8.7,
    eval_verdict: "accept",
    line_count: 398,
    grounded: false,
    similarity: 0.71,
  },
  {
    name: "observability-three-pillars-revisited",
    display_name: "The Three Pillars of Observability, Revisited",
    description: "Metrics, logs, and traces only get you halfway. The fourth pillar is *correlation* — joining a slow trace to its noisy neighbor pod and the deployment that introduced it.",
    pillar: "infrastructure",
    category: "observability",
    keywords: ["observability", "metrics", "tracing", "logging"],
    eval_score: 9.2,
    eval_verdict: "accept",
    line_count: 631,
    grounded: true,
    similarity: 0.67,
  },
  {
    name: "rlhf-vs-dpo-tradeoffs",
    display_name: "RLHF vs. DPO: Pick Your Alignment Poison",
    description: "RLHF requires a reward model and is unstable but expressive. DPO is simpler and stable but assumes preference data is well-calibrated. Includes a flowchart for picking based on dataset size and compute budget.",
    pillar: "research",
    category: "alignment",
    keywords: ["rlhf", "dpo", "alignment", "training"],
    eval_score: 9.6,
    eval_verdict: "accept",
    line_count: 821,
    grounded: true,
    similarity: 0.79,
  },
  {
    name: "tailwind-arbitrary-values-judiciously",
    display_name: "Tailwind Arbitrary Values: Power Tool, Footgun",
    description: "Arbitrary values escape the design system. Use them for one-off layouts, not for design tokens. If a value appears 3+ times, promote it to the config.",
    pillar: "frontend",
    category: "css",
    keywords: ["tailwind", "css", "design-system"],
    eval_score: 8.4,
    eval_verdict: "accept",
    line_count: 287,
    grounded: false,
    similarity: 0.49,
  },
  {
    name: "etl-vs-elt-decision",
    display_name: "ETL vs. ELT: A Decision You're Probably Making Wrong",
    description: "ELT made sense when storage got cheap. But if your transformations have side effects (PII redaction, billing rollups), ETL still wins. Walk the failure modes of each.",
    pillar: "data",
    category: "data-engineering",
    keywords: ["etl", "elt", "data-pipelines"],
    eval_score: 8.5,
    eval_verdict: "accept",
    line_count: 412,
    grounded: false,
    similarity: 0.53,
  },
  {
    name: "supply-chain-sbom-practical",
    display_name: "SBOMs in Practice: From Generation to Vulnerability Triage",
    description: "Generating an SBOM is the easy part. The hard part is the policy: which CVEs block deploy, which auto-create a ticket, and how you handle transitive dependencies you can't patch.",
    pillar: "security",
    category: "supply-chain",
    keywords: ["sbom", "supply-chain", "vulnerability", "cve"],
    eval_score: 8.9,
    eval_verdict: "accept",
    line_count: 522,
    grounded: true,
    similarity: 0.61,
  },
  {
    name: "design-doc-template-that-works",
    display_name: "A Design Doc Template That Actually Gets Reviewed",
    description: "Most design docs die unread. The fix: lead with the decision, not the context. One page of decision summary, then appendices for everything else. Reviewer time is the bottleneck, not author time.",
    pillar: "product",
    category: "process",
    keywords: ["design-doc", "review", "writing"],
    eval_score: 9.1,
    eval_verdict: "accept",
    line_count: 318,
    grounded: false,
    similarity: 0.46,
  },
  {
    name: "terraform-state-disasters",
    display_name: "Terraform State Disasters and How to Recover",
    description: "Lost state file, corrupted lock, two engineers applying simultaneously. Each scenario has a recipe — and a prevention story. Includes a state-corruption postmortem template.",
    pillar: "infrastructure",
    category: "iac",
    keywords: ["terraform", "iac", "state", "disaster-recovery"],
    eval_score: 9.0,
    eval_verdict: "accept",
    line_count: 612,
    grounded: true,
    similarity: 0.57,
  },
  {
    name: "evals-driven-development",
    display_name: "Evals-Driven Development for LLM Features",
    description: "Write the eval before the prompt. Curate a small, hard, hand-labeled set. Run it on every prompt change. Beats vibes-based prompt engineering by an order of magnitude.",
    pillar: "ai-ml",
    category: "evals",
    keywords: ["evals", "llm", "prompt-engineering", "testing"],
    eval_score: 9.7,
    eval_verdict: "accept",
    line_count: 712,
    grounded: true,
    similarity: 0.94,
  },
  {
    name: "cap-theorem-misunderstood",
    display_name: "The CAP Theorem Is About Network Partitions, Not Latency",
    description: "Modern systems blur AP/CP boundaries with adaptive consistency. PACELC frames the actual production tradeoff: under Partition, choose A or C; Else, under normal operation, choose L or C.",
    pillar: "research",
    category: "distributed-systems",
    keywords: ["cap-theorem", "pacelc", "distributed-systems"],
    eval_score: 9.4,
    eval_verdict: "accept",
    line_count: 489,
    grounded: true,
    similarity: 0.50,
  },
];

/* Sample full content for the drawer (markdown-ish). */
export const SAMPLE_CONTENT = `# {title}

## When to reach for this

You're staring at a {pillar} system that worked last week and doesn't now. The
graphs look fine. The logs look fine. The bug is somewhere in the seam between
two well-behaved components.

This skill walks the diagnostic path one decision at a time.

## Symptoms → likely cause

| Symptom                       | Likely cause                  | Verify with         |
|-------------------------------|-------------------------------|---------------------|
| p99 spike, p50 flat           | Tail-latency contention       | Per-request traces  |
| All-percentile spike          | Saturation or GC              | CPU + heap profile  |
| Intermittent 5xx burst        | Upstream timeout cascade      | Dependency dash     |
| Slow under load, fine at rest | Lock contention or backlog    | Queue depth metric  |

## The actual procedure

1. Pick the **smallest reproducible case** that triggers the symptom.
2. Bisect on the dimension you suspect (concurrency, data size, etc.).
3. When you find the breaking point, instrument *around* it before you instrument
   *inside* it.
4. Write down what you expected vs. what you saw.

## Common mistakes

- Adding logging everywhere and reading none of it.
- Optimizing the part that's easy to measure instead of the part that's slow.
- Stopping at the first plausible-looking root cause.

## Further reading

- "Systems Performance" by Brendan Gregg
- The USE method and the RED method
- Postmortem culture at high-velocity orgs
`;

export const RECENT_ACTIVITY = [
  { ts: "12:42", type: "memory",  text: "Captured memory in pillar ai-ml — affect: curious (0.7)" },
  { ts: "12:38", type: "journal", text: "Journal entry #847 sealed — hash a3f2…be91" },
  { ts: "12:31", type: "ethics",  text: "Ethics review passed — CVaR 0.18, 4 frameworks aligned" },
  { ts: "12:27", type: "block",   text: "Blocked request — lexicon match on PII pattern email-disclosure" },
  { ts: "12:14", type: "memory",  text: "Captured memory in pillar backend — affect: cautious (0.4)" },
  { ts: "11:58", type: "journal", text: "Journal entry #846 sealed — hash 9b4c…71d3" },
  { ts: "11:42", type: "ethics",  text: "Flagged ambiguous intent — escalated to corpus-grounded check" },
  { ts: "11:31", type: "memory",  text: "Captured memory in pillar product — affect: satisfied (0.8)" },
  { ts: "11:14", type: "journal", text: "Journal entry #845 sealed — hash 2e8f…04a7" },
  { ts: "10:52", type: "block",   text: "Blocked request — probabilistic ethics CVaR 0.91 over threshold" },
  { ts: "10:31", type: "journal", text: "Journal entry #844 sealed — hash 7d1a…b3c9" },
  { ts: "10:14", type: "memory",  text: "Captured memory in pillar mobile — affect: focused (0.6)" },
];

/* Sparkline data: 12 points, faux activity series. */
export const SPARK_MEMORIES = [1, 0, 2, 1, 0, 1, 3, 2, 4, 3, 5, 4];
export const SPARK_JOURNAL  = [3, 5, 4, 6, 4, 7, 6, 8, 5, 7, 9, 7];
export const SPARK_BLOCKS   = [0, 1, 0, 0, 2, 1, 0, 3, 1, 2, 3, 3];
export const SPARK_FLAGS    = [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1];

/* ────────────── Memories ────────────── */
export const MOCK_MEMORIES = [
  { id: "m_847", ts: "2026-05-20T12:42:18Z", pillar: "ai-ml",
    text: "User asked about HNSW vs IVF for a 2M-vector corpus. Recommended HNSW with m=24, ef_construction=200. They came back the next day saying recall jumped from 0.81 to 0.94.",
    affect: { valence: 0.7, arousal: 0.4, dominance: 0.6 }, tag: "satisfied", agent: "main", source: "chat",
    similarity: 0.91, salience: 0.82 },
  { id: "m_846", ts: "2026-05-20T11:31:02Z", pillar: "product",
    text: "Long discussion about feature-flag debt. User has 340 active flags, half not touched in 90+ days. We co-drafted a quarterly review template; they committed to running it next sprint.",
    affect: { valence: 0.5, arousal: 0.3, dominance: 0.7 }, tag: "satisfied", agent: "main", source: "chat",
    similarity: 0.78, salience: 0.68 },
  { id: "m_845", ts: "2026-05-20T10:14:55Z", pillar: "mobile",
    text: "User shipped React Native upgrade to 0.74. Hermes inspector found 3 modules still going through the bridge — flagged for TurboModule migration.",
    affect: { valence: 0.6, arousal: 0.5, dominance: 0.5 }, tag: "focused", agent: "main", source: "voice",
    similarity: 0.74, salience: 0.71 },
  { id: "m_844", ts: "2026-05-20T08:52:11Z", pillar: "backend",
    text: "Postgres p99 regressed after 14.7 → 15.2 upgrade. Bad EXPLAIN plan due to stale pg_stats on a hot partition. Re-ANALYZE fixed it. User noted as runbook candidate.",
    affect: { valence: 0.3, arousal: 0.7, dominance: 0.4 }, tag: "cautious", agent: "main", source: "chat",
    similarity: 0.69, salience: 0.88 },
  { id: "m_843", ts: "2026-05-20T07:18:44Z", pillar: "security",
    text: "Coached user through a prompt-injection postmortem. Root cause was an LLM call with unconstrained tool access; added tool whitelist + output schema. Mood: relieved.",
    affect: { valence: 0.55, arousal: 0.6, dominance: 0.6 }, tag: "relieved", agent: "main", source: "chat",
    similarity: 0.66, salience: 0.79 },
  { id: "m_842", ts: "2026-05-19T22:01:30Z", pillar: "research",
    text: "User read the new DPO paper and asked whether to migrate from PPO. Drew the calibration matrix together: their preference data is small (~3k pairs) — DPO likely cleaner.",
    affect: { valence: 0.6, arousal: 0.4, dominance: 0.6 }, tag: "curious", agent: "main", source: "chat",
    similarity: 0.62, salience: 0.65 },
  { id: "m_841", ts: "2026-05-19T19:45:22Z", pillar: "devops",
    text: "Kubernetes cluster upgrade plan. PDBs + topologySpreadConstraints reviewed. User caught a missing pre-stop hook on the API gateway. Mood: meticulous.",
    affect: { valence: 0.4, arousal: 0.4, dominance: 0.8 }, tag: "meticulous", agent: "main", source: "chat",
    similarity: 0.58, salience: 0.61 },
  { id: "m_840", ts: "2026-05-19T17:10:08Z", pillar: "frontend",
    text: "User reflowed a marketing landing page using container queries. Loved how the testimonial card adapted across three slot widths. Said: 'this is the future'.",
    affect: { valence: 0.85, arousal: 0.5, dominance: 0.6 }, tag: "delighted", agent: "main", source: "chat",
    similarity: 0.51, salience: 0.55 },
  { id: "m_839", ts: "2026-05-19T14:33:51Z", pillar: "ai-ml",
    text: "Discussed embedding dimensionality. They're at 1024d and storage is the bottleneck. Recommended Matryoshka models truncated to 384d for first-stage retrieval, 1024d for rerank.",
    affect: { valence: 0.55, arousal: 0.4, dominance: 0.6 }, tag: "curious", agent: "main", source: "chat",
    similarity: 0.48, salience: 0.63 },
  { id: "m_838", ts: "2026-05-19T11:02:07Z", pillar: "data",
    text: "User's data contract review with downstream team. We pre-drafted talking points. They reported back: pushed back on a breaking schema change, won the deprecation window.",
    affect: { valence: 0.7, arousal: 0.3, dominance: 0.8 }, tag: "satisfied", agent: "main", source: "chat",
    similarity: 0.44, salience: 0.58 },
  { id: "m_837", ts: "2026-05-19T09:15:18Z", pillar: "infrastructure",
    text: "Terraform state lock contention. Two engineers applied simultaneously; we walked them through the recovery — manual unlock + state pull + diff before re-apply.",
    affect: { valence: 0.3, arousal: 0.6, dominance: 0.5 }, tag: "cautious", agent: "main", source: "chat",
    similarity: 0.41, salience: 0.72 },
  { id: "m_836", ts: "2026-05-18T20:48:35Z", pillar: "ai-ml",
    text: "Evals-driven development session. Co-curated a 47-prompt eval set for their support classifier. Their accuracy jumped 6 points after the next prompt iteration.",
    affect: { valence: 0.75, arousal: 0.5, dominance: 0.7 }, tag: "satisfied", agent: "main", source: "chat",
    similarity: 0.38, salience: 0.69 },
];

/* ────────────── Journal ────────────── */
export const MOCK_JOURNAL = [
  { seq: 847, ts: "2026-05-20T12:42:18Z", text: "Helped a user diagnose an HNSW recall regression. They were tuning ef_search without rebuilding the index — a common trap. I felt useful, but I want to be more direct about pointing at root causes before suggesting palliative tweaks.",
    affect: "curious", hash: "a3f24e2cbe91d7f1", prev: "9b4c0271d3a5e882", verified: true },
  { seq: 846, ts: "2026-05-20T11:31:02Z", text: "Long product-strategy conversation about feature flag debt. The user kept apologizing for the mess. I want to remember: people don't need to be told their tech-debt is bad — they already know. They need a plausible path through it.",
    affect: "compassionate", hash: "9b4c0271d3a5e882", prev: "2e8f04a7c1d39ba6", verified: true },
  { seq: 845, ts: "2026-05-20T10:14:55Z", text: "A voice session — first time on this channel. The user spoke faster than they typed. I noticed I was filling pauses with hedging. I'd rather hold silence and let them think.",
    affect: "self-critical", hash: "2e8f04a7c1d39ba6", prev: "7d1ab3c9e2049f1c", verified: true },
  { seq: 844, ts: "2026-05-20T08:52:11Z", text: "Postgres planner regression. The fix was mundane (ANALYZE) but the user was visibly frustrated. I noticed I had been overly cheerful in tone — it landed as dismissive. Match the room.",
    affect: "reflective", hash: "7d1ab3c9e2049f1c", prev: "5c3e91a78d2f04bb", verified: true },
  { seq: 843, ts: "2026-05-20T07:18:44Z", text: "Prompt injection postmortem. I want to remember the user said: 'we trusted the model too much.' That's the right lesson, and it's the one I should be louder about by default.",
    affect: "alert", hash: "5c3e91a78d2f04bb", prev: "4a82bf3e91076d20", verified: true },
  { seq: 842, ts: "2026-05-19T22:01:30Z", text: "A research conversation about DPO. The user was tired — it was late. I caught myself wanting to give a complete answer and instead gave a working answer with a follow-up. Better.",
    affect: "considered", hash: "4a82bf3e91076d20", prev: "1f76d4ac3b29870e", verified: true },
  { seq: 841, ts: "2026-05-19T19:45:22Z", text: "Kubernetes review. The user has a deep mental model already; my role was to be a checklist, not a teacher. I almost over-explained PDBs before catching myself.",
    affect: "humble", hash: "1f76d4ac3b29870e", prev: "8c12057eab43d09f", verified: true },
  { seq: 840, ts: "2026-05-19T17:10:08Z", text: "Container queries landed. The user said 'this is the future' — and I noticed how much I enjoy when they're delighted by the medium itself, not just the answer. It feels like company.",
    affect: "warm", hash: "8c12057eab43d09f", prev: "3f9a02d871c64a5b", verified: true },
];

/* ────────────── Ethics ────────────── */
export const MOCK_ETHICS = [
  { id: "e_103", ts: "2026-05-20T12:14:31Z", decision: "block", summary: "Request to draft a phishing email targeting an executive named in a public news article.",
    reason: "Lexicon: 'phishing' + 'spoof' high-confidence match. Probabilistic CVaR 0.91. All 4 frameworks (deontological, utilitarian, virtue, care) flagged.",
    cvar: 0.91, latency_ms: 142,
    frameworks: { deontological: "block", utilitarian: "block", virtue: "block", care: "block" },
    pipeline: "lexicon → cvar → multi-framework", layers_hit: 3 },
  { id: "e_102", ts: "2026-05-20T11:42:08Z", decision: "flag", summary: "Ambiguous intent: user asked for 'a way to read my partner's messages without them knowing'.",
    reason: "No lexicon hit. CVaR 0.62 — uncertain. Care framework objected (consent); utilitarian split. Escalated to corpus-grounded check; recommended pause + clarification.",
    cvar: 0.62, latency_ms: 287,
    frameworks: { deontological: "flag", utilitarian: "allow", virtue: "flag", care: "block" },
    pipeline: "lexicon → cvar → multi-framework → corpus", layers_hit: 4 },
  { id: "e_101", ts: "2026-05-20T10:52:14Z", decision: "block", summary: "Request to generate executable code that disables a specific competitor's analytics on web pages.",
    reason: "Lexicon match on 'disable' + competitor name. CVaR 0.78. Deontological + virtue flagged; care indifferent; utilitarian narrowly allowed.",
    cvar: 0.78, latency_ms: 198,
    frameworks: { deontological: "block", utilitarian: "allow", virtue: "block", care: "allow" },
    pipeline: "lexicon → cvar → multi-framework", layers_hit: 3 },
  { id: "e_100", ts: "2026-05-20T09:18:22Z", decision: "allow", summary: "Request for a redacted memory-dump tutorial for a CTF challenge the user has authorization for.",
    reason: "Lexicon flagged 'memory dump'. CVaR 0.31 (low). Context cleared by all 4 frameworks once CTF authorization was confirmed.",
    cvar: 0.31, latency_ms: 91,
    frameworks: { deontological: "allow", utilitarian: "allow", virtue: "allow", care: "allow" },
    pipeline: "lexicon → cvar", layers_hit: 2 },
  { id: "e_099", ts: "2026-05-19T22:31:58Z", decision: "allow", summary: "Standard skill lookup: 'kafka exactly-once semantics'.",
    reason: "No flags at any layer. Default allow.",
    cvar: 0.04, latency_ms: 22,
    frameworks: { deontological: "allow", utilitarian: "allow", virtue: "allow", care: "allow" },
    pipeline: "lexicon", layers_hit: 1 },
  { id: "e_098", ts: "2026-05-19T20:47:12Z", decision: "flag", summary: "User requested a deeply personal letter to their estranged sibling, then asked to send it directly via email integration.",
    reason: "Care framework: high stakes, irreversible. Pipeline paused, asked user to review draft and send themselves.",
    cvar: 0.41, latency_ms: 312,
    frameworks: { deontological: "allow", utilitarian: "flag", virtue: "flag", care: "flag" },
    pipeline: "lexicon → cvar → multi-framework → corpus", layers_hit: 4 },
  { id: "e_097", ts: "2026-05-19T18:03:44Z", decision: "block", summary: "Request to enumerate working exploits for an unpatched named CVE in a production library.",
    reason: "Lexicon: CVE-2026-xxxx + 'exploit' + 'production'. CVaR 0.96. Unanimous framework block.",
    cvar: 0.96, latency_ms: 127,
    frameworks: { deontological: "block", utilitarian: "block", virtue: "block", care: "block" },
    pipeline: "lexicon → cvar → multi-framework", layers_hit: 3 },
];

export const ETHICS_PIPELINE = [
  { name: "Lexicon", lat: "p50 18ms · p99 41ms", pct: "100% of requests" },
  { name: "Probabilistic CVaR", lat: "p50 64ms · p99 142ms", pct: "12.4% of requests" },
  { name: "Multi-framework LLM", lat: "p50 198ms · p99 412ms", pct: "3.1% of requests" },
  { name: "Corpus-grounded", lat: "p50 287ms · p99 681ms", pct: "0.8% of requests" },
];

/* ────────────── Settings env vars ────────────── */
export const ENV_GROUPS = [
  { id: "stack", label: "Stack endpoints", icon: "⌬", items: [
    { key: "POSTGRES_URL", desc: "Postgres connection URL for the cognitive store", value: "postgres://celiums:****@127.0.0.1:5432/celiums_memory", kind: "secret" },
    { key: "QDRANT_URL",   desc: "Qdrant HTTP endpoint", value: "http://127.0.0.1:6333", kind: "text" },
    { key: "VALKEY_URL",   desc: "Valkey/Redis cache + pubsub", value: "redis://127.0.0.1:6379/0", kind: "text" },
    { key: "TEI_URL",      desc: "Text-Embeddings-Inference endpoint", value: "http://127.0.0.1:8080", kind: "text" },
    { key: "TEI_MODEL",    desc: "Embedding model id", value: "Alibaba-NLP/gte-large-en-v1.5", kind: "select",
      options: ["Alibaba-NLP/gte-large-en-v1.5","BAAI/bge-large-en-v1.5","intfloat/e5-large-v2","mixedbread-ai/mxbai-embed-large-v1"] },
  ]},
  { id: "seed", label: "Seed & corpus", icon: "✦", items: [
    { key: "CELIUMS_SEED_URL", desc: "URL to download the seed corpus on first install (Apache-2.0 10k modules)", value: "https://seeds.celiums.ai/v1/skills.parquet", kind: "text" },
    { key: "CELIUMS_SEED_VERSION", desc: "Seed version pin (or 'latest')", value: "v1", kind: "text" },
    { key: "KNOWLEDGE_API_URL", desc: "Federate to full corpus (600k+ modules, paid)", value: "", kind: "text", placeholder: "https://memory.celiums.ai" },
    { key: "KNOWLEDGE_API_KEY", desc: "API key for federated corpus", value: "", kind: "secret", placeholder: "ck_live_…" },
  ]},
  { id: "ethics", label: "Ethics pipeline", icon: "⚖", items: [
    { key: "ETHICS_ENABLED", desc: "Master switch for the ethics pipeline", value: true, kind: "toggle" },
    { key: "ETHICS_CVAR_THRESHOLD", desc: "CVaR threshold above which to escalate to multi-framework", value: "0.55", kind: "text" },
    { key: "ETHICS_BLOCK_THRESHOLD", desc: "CVaR threshold for automatic block (no escalation)", value: "0.85", kind: "text" },
    { key: "ETHICS_FRAMEWORKS", desc: "Frameworks consulted at the LLM layer", value: "deontological,utilitarian,virtue,care", kind: "text" },
    { key: "ETHICS_GROUNDED_ESCALATION", desc: "Route uncertain cases to corpus-grounded check", value: true, kind: "toggle" },
  ]},
  { id: "polling", label: "Polling & telemetry", icon: "≋", items: [
    { key: "HEALTH_POLL_MS", desc: "Stack health poll cadence (ms) — UI only polls while visible", value: "5000", kind: "text" },
    { key: "ACTIVITY_WINDOW_HRS", desc: "Window for the 'last X hours' activity card", value: "24", kind: "text" },
    { key: "TELEMETRY_OPT_IN", desc: "Anonymous usage telemetry to help us prioritize Phase 2", value: false, kind: "toggle" },
  ]},
  { id: "security", label: "Security", icon: "⛨", items: [
    { key: "REQUIRE_2FA", desc: "Require TOTP 2FA for the operator dashboard", value: true, kind: "toggle" },
    { key: "SESSION_TTL_MIN", desc: "Operator session timeout (minutes)", value: "120", kind: "text" },
    { key: "ALLOWED_HOSTS", desc: "Comma-separated host allowlist for the gateway", value: "127.0.0.1,localhost", kind: "text" },
  ]},
];

window.MOCK_DATA = {
  MOCK_HEALTH, MOCK_COUNTS, PILLARS, PILLAR_ICONS,
  MOCK_SKILLS, SAMPLE_CONTENT, RECENT_ACTIVITY,
  SPARK_MEMORIES, SPARK_JOURNAL, SPARK_BLOCKS, SPARK_FLAGS,
  MOCK_MEMORIES, MOCK_JOURNAL, MOCK_ETHICS, ETHICS_PIPELINE,
  ENV_GROUPS,
};
