# CLAUDE.md — celiums-cognition control plane

**Authority of this project = `HANDOFF.md`** (the 2026-05-19 plugin-not-fork
handoff, originally at `/Users/mars/Downloads/HANDOFF.md`, mirrored in §refs).
Decisions D1–D10 and rules §6 below are LOCKED. Do not reopen without Mario
explicit. **The real OpenClaw source code is the authority on the SDK, NOT
memories** (a 2026-04-28 memory falsely claimed real APIs were confabulated —
Mario's standing instruction: verify against code, not recall).

---

## 0. MANDATORY PIPELINE — Celiums Memory MCP (run EVERY session)

This project's memory lives in **Celiums Memory** (MCP tools
`mcp__claude_ai_Celiums_Memory__*`). The plugin is already connected. Using it
is non-negotiable (Mario, 2026-05-19: *"quiero asegurarme de que lo uses"*).

**At session start, before any non-trivial work:**
1. `recall` with queries relevant to the task (e.g. `"celiums-cognition fase N"`,
   `"OpenClaw plugin SDK seam <X>"`). Recall returns large blobs — extract the
   signal with `jq`/grep on the saved tool-result file; do **not** dump it.
   *Do not be steered by stale memory content over the real code / HANDOFF.*
2. `journal_write` an entry, `agent_id="claude-opus-4-7"` (or your model id),
   `entry_type="decision"`, tags incl. `session-start`, `preceded_by` the prior
   session's last entry id (causal chain). The journal is SHA-hash-chained.

**At every milestone** (phase done, decision committed, risk resolved, pivot):
- `journal_write` `entry_type` ∈ `decision|lesson|belief|reflection`, with
  `preceded_by` linking the chain, plus `valence`/`valence_reason`.
- `remember` the durable facts (locked versions, verified seams, gotchas)
  with tags; project scope auto-detected from cwd.

**At session end:** `journal_write` a `session-end`-tagged entry: summary +
next steps + open risks.

**If recall returns empty / bridge unreachable:** STOP, tell Mario the bridge
is broken (do not proceed on incomplete context). This is a hard rule.

Journal chain so far (latest last): `5aa1faea` → `c2b5e49c` → … keep extending
via `preceded_by`.

---

## 1. LOCKED FACTS (verified Fase 0, 2026-05-19)

| Key | Value |
|---|---|
| `OPENCLAW_VERSION` (verified SDK tree) | **2026.5.19** — `/Volumes/My Book/Documents/openclaw-study`, commit `78d226bb`, branch `main` |
| npm registry reality | `openclaw` latest **stable = 2026.5.18**; `2026.5.19-beta.1` is beta; `2026.5.19` not yet a stable npm release |
| Plugin compat declared | `openclaw.compat.pluginApi: ">=2026.5.18"`, `openclaw.build.openclawVersion: "2026.5.19"`, optional peer `openclaw: ">=2026.5.18"` |
| npm scope | `@celiumsai` (D7, reserved by Mario) |
| pglite + pgvector (RISK #1) | **PASS** — `@electric-sql/pglite@0.4.5` + `@electric-sql/pglite/vector` → pgvector **0.8.1**; `vector(N)`, `<->`, HNSW `vector_cosine_ops` all verified. Fase 4 unblocked, no fallback. |
| Vendor source | celiums-memory working tree `/Volumes/My Book/Documents/celiums-memory` (Fase 2) |
| Repo | `/Volumes/My Book/Documents/celiums-cognition`, branch `main`, git author `Mario Gutierrez <terrizoaguimor@gmail.com>` |

## 2. VERIFIED SDK SEAM MAP (anti-confabulation — §0.4, §6.4)

Verified by reading real OpenClaw code (`openclaw-study`). The HANDOFF §3.3
template HOLDS. Canonical references to imitate:
`extensions/memory-core/index.ts` (slot + tools + cli + command) and
`extensions/memory-lancedb/index.ts` (hooks + service).

- `import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry"` —
  `definePluginEntry({ id, name, description, kind?, configSchema?, register(api) })`.
  `kind` is **deprecated in the runtime entry** → declare `kind` in
  `openclaw.plugin.json` instead.
- Real `api.*`: `registerMemoryCapability({promptBuilder,flushPlanResolver,runtime,publicArtifacts})`,
  `registerTool(def|factory,{names})`, `registerCommand({name,description,acceptsArgs,handler})`,
  `registerCli(fn,{descriptors})`, `registerService({start,stop})`,
  `registerContextEngine`, `registerTrustedToolPolicy` (all REAL — verified).
- Real lifecycle events for `api.on(...)`: `before_agent_run`, `before_agent_start`,
  `before_prompt_build`, `before_tool_call`, `before_model_resolve`,
  `before_compaction`, `agent_end`, `session_start`, `session_end`,
  `tool_result`, `tool_result_persist`, `llm_input`, `llm_output`, …
- `openclaw.plugin.json` `contracts` is an **OBJECT** `{tools:[],memoryEmbeddingProviders:[]}`,
  **not an array** (HANDOFF §3.2 was wrong here). Also has `id`, `kind`,
  `activation:{onStartup}`, `commandAliases:[{name,kind:"runtime-slash",cliCommand}]`,
  `uiHints`, `configSchema` (JSON Schema 2020-12, `additionalProperties:false`).
- External (ClawHub) plugins **require** `openclaw.compat.pluginApi` +
  `openclaw.build.openclawVersion` in package.json (validated by
  `@openclaw/plugin-package-contract`).

### 2b. Fase-3 EXTERNAL-plugin contract (verified 2026-05-19, blueprint)

**`registerTrustedToolPolicy` and `registerCodexAppServerExtensionFactory`
are BUNDLED-PLUGINS-ONLY** (`types.ts:2732`). We are an EXTERNAL ClawHub
plugin → the HANDOFF §3.3 ethics-via-`registerTrustedToolPolicy` template
DOES NOT WORK for us. `registerContextEngine` is an exclusive slot.

Proven external pattern = **`extensions/memory-lancedb`** (HANDOFF §10.1
reference; it is external-installable and does NOT use
`registerMemoryCapability` nor `registerTrustedToolPolicy`):

- `packages/shared/src/api.ts` shim = exactly:
  `export { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";`
- `export default definePluginEntry({ id, name, description, kind?, configSchema?, register(api) })`
- Tools: `api.registerTool({ name, label, description, parameters: Type.Object({...}) /*TypeBox*/, async execute(_toolCallId, params) { return { content:[{type:"text",text}], details:{} }; } }, { name })`
- Auto-recall: `api.on("before_prompt_build", async (event) => …)` →
  return `{ prependContext: string }` or `undefined`. Guard with a timeout
  (don't stall agent start). `event.prompt`, `event.messages`.
- Auto-capture: `api.on("agent_end", async (event, ctx) => …)` — side
  effect only (void). `event.success`, `event.messages`,
  `ctx.sessionKey`/`ctx.sessionId`; keep a per-session cursor.
- Ethics gate (engine.ethics): public hooks, NOT registerTrustedToolPolicy
  — `api.on("before_tool_call", (event, ctx) ⇒ PluginHookBeforeToolCallResult|void)`
  and `api.on("before_agent_run", (event{prompt,messages,systemPrompt,
  senderIsOwner}, ctx) ⇒ InputGateDecision|void)` (pre-LLM pass/block).
- Journal: `api.on("agent_end" | "tool_result_persist")`; flush on
  `api.on("before_compaction")`. Cleanup on `api.on("session_end")`.
- `api.registerService({ id, start, stop })`, `api.registerCli(...)`,
  `api.registerCommand(...)`. `kind:"memory"` lives in
  `openclaw.plugin.json` (deprecated in the runtime entry).
- Tool param schemas use **TypeBox** (`import { Type } from "typebox"`).

## 3. DEVIATION LOG (this repo vs HANDOFF — intentional, with reasons)

1. **`pluginApi`/peer = `>=2026.5.18`** not `2026.5.19` — npm stable latest is
   2026.5.18; 2026.5.19 has no stable npm release. Re-verify exact pluginApi
   semantics at Fase 6 (ClawHub `--dry-run` validates). `build.openclawVersion`
   stays `2026.5.19` (the tree we verified the SDK against).
2. **`pnpm-workspace.yaml` `autoInstallPeers: false`** — HANDOFF §3.1 devDeps
   `openclaw/@openclaw/plugin-sdk: workspace:*` only resolve *inside* the
   OpenClaw monorepo. This is a standalone repo. pnpm 11.0.4 ignores `.npmrc`
   for this and auto-installs the optional `openclaw` peer (pulling heavy
   native deps sharp/koffi/… → triggers `ERR_PNPM_IGNORED_BUILDS`, an
   interactive-only gate). `autoInstallPeers:false` keeps the dev tree minimal
   and install deterministic (272 ms, exit 0).
3. **OpenClaw SDK types wired in Fase 3, not Fase 1** — Fase 1 packages are
   placeholders with no SDK imports, so types aren't needed yet. Fase 3 adds
   `openclaw` (pinned, e.g. `2026.5.19-beta.1` or `2026.5.18`) as an explicit
   **devDependency** of `shared` for `import … from "openclaw/plugin-sdk/*"`
   typecheck, configuring pnpm build-script approval at that point
   (`onlyBuiltDependencies`/dedicated install). Keep it OUT of `dependencies`.
4. **`.npmrc` kept** (ignore-scripts/auto-install-peers/strict-peer) for
   non-pnpm-11 / CI compatibility, but pnpm 11.0.4 honors the
   `pnpm-workspace.yaml` equivalents — the workspace yaml is the source of
   truth here. **Install command of record: `pnpm install --ignore-scripts`**
   (the CLI flag IS honored by pnpm 11; `.npmrc ignore-scripts` is not).
   Keeps install headless/deterministic and dodges the interactive
   `ERR_PNPM_IGNORED_BUILDS` build-approval gate.
5. **5th workspace package `packages/memory-types`** — `@celiums/memory-types`
   is a celiums-memory workspace sibling NOT on npm at v2.0.0 (npm has only
   0.1.x/0.2.x). Vendored as a private package, resolved via `workspace:*`
   exactly as upstream → the 19 engine files importing it need ZERO rewrite.
6. **Engine vendored wholesale, structure intact** (Mario's call 2026-05-19):
   `celiums-memory/packages/core/src/**` → `packages/engine/src/**` verbatim
   (252 files), NOT curated into the §2.1 idealized 6-dir layout (would
   require rewriting hundreds of intra-engine imports — failure mode #1).
   engine `tsconfig.json` is self-contained mirroring upstream's EFFECTIVE
   (looser) compiler options — NOT this repo's strict base.
7. **§2.3-vs-§3.4 conflict resolved — `mcp/atlas-tools.ts` + `lib/atlas.ts`
   ARE vendored** (NOT excluded). §2.3 says "exclude Atlas server"; that
   means the SEPARATE `celiums-memory/packages/atlas-server` package (never
   in our copy scope), NOT `mcp/atlas-tools.ts` which is engine tool-handler
   code hosting `bloom/cultivate/synthesize/decompose/construct/pollinate`
   — cognitive primitives the §3.4 curated/`all` surface explicitly requires.
   atlas-tools.ts imports only engine-internal types (zero SaaS/transport
   contamination, verified). The `atlas_*` gateway tools come along but are
   inert by default (dispatcher gates `group:'atlas'` off unless
   `CELIUMS_ATLAS_KEY`). Only excludes: `quickstart.ts`, `init.ts`,
   `v1-routes/` (genuine HTTP transport). The Explore-agent
   "ZERO contamination, exclude atlas" conclusion was WRONG on atlas —
   caught by the real build, fixed. Lesson: real build/code is authority.
8. **`better-sqlite3` native binary not built** (optional dep; headless
   `--ignore-scripts` install). `smoke-sqlite-real.test.ts` +
   `runtime-bootstrap.test.ts` are resource-gated out in engine
   `vitest.config.ts` (HANDOFF §6.6: Lite uses pglite/WASM, not
   better-sqlite3; SqliteAdapter is only the structural base for the
   Fase-4 pglite adapter). 704 logic tests + typecheck + build all green.

## 4. NON-NEGOTIABLE RULES (HANDOFF §6)

1. **NO `Co-Authored-By: Claude`** in commits. Author = Mario Gutierrez.
2. **NO push** to GitHub without explicit Mario OK (first push coordinated;
   Mario creates the empty repo — org TBD: `celiumssolutions` default vs
   `terrizoaguimor`). `git remote` not set yet.
3. **NO npm/ClawHub publish** without explicit OK (Fase 7, gated).
4. **NO confabulated SDK APIs.** Verify against `openclaw-study` real code
   before using any `register*`/`api.on`. Memories are NOT authoritative.
5. **NO reuse of `celiums-claw`** (archived fork — already deleted from disk).
6. **NO IPs / hostnames / secrets / API keys** in tracked files or commit msgs.
7. **Lite is NOT degraded** — identical ethics/journal/PAD/retrieval as Hard;
   only storage differs (embedded pglite vs PG-triple).
8. ES prose / EN technical mix is fine in docs & comments.
9. Journal discipline per §0 above.

## 5. PHASE STATUS

- [x] Fase 0 — pre-flight (scope, OPENCLAW_VERSION, pglite smoke PASS, git init)
- [x] Fase 0b — SDK seams verified vs real code
- [x] Fase 1 — monorepo scaffold (pnpm install clean, 4 packages build+typecheck green)
- [x] Fase 1b — this CLAUDE.md (Celiums Memory pipeline encoded)
- [x] Fase 2 — engine vendored from celiums-memory v2.0.0 (commit 6012e714):
      252 files + memory-types pkg, build ESM+DTS green, typecheck clean,
      704 logic tests pass / 19 skip / 0 fail. 5 workspace packages.
- [~] Fase 3 — plugin Hard BUILT (commit d492e90): shared adapter (verified
      memory-lancedb pattern) + hard (manifest, entry, compose, setup),
      tsup bundles private pkgs into dist/index.js (474K), externals
      openclaw + third-party. 5 pkgs build green. **E2E smoke PENDING**
      (live OpenClaw on DO nyc1 VPS — in progress).
- [ ] Fase 4 — plugin Lite (pglite-embedded adapter; unblocked)
- [ ] Fase 5 — READMEs + docs + examples
- [ ] Fase 6 — CI + release prep (ClawHub dry-run, re-verify compat)
- [ ] Fase 7 — publish (GATED by Mario)

Day-1 target = Fases 0–2. Hard E2E = Day 2.

## 6. COMMANDS

```
pnpm install                                  # clean, ~0.3s, no native builds
pnpm -r --filter "./packages/*" build         # tsc per package, topo order
pnpm -r --filter "./packages/*" typecheck
pnpm -r --filter "./packages/*" test
```

Vendoring header (every vendored engine .ts — HANDOFF §2.3):
```ts
/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 * Originally derived from celiums-memory v2.0
 * (https://github.com/terrizoaguimor/celiums-memory, Apache 2.0)
 */
```

## 7. REFERENCES

- `HANDOFF.md` — single authority (phases, contracts, acceptance, decisions).
- OpenClaw real source: `/Volumes/My Book/Documents/openclaw-study`
  (`extensions/memory-core`, `extensions/memory-lancedb`,
  `src/plugin-sdk/plugin-entry.ts`, `src/plugins/types.ts`,
  `packages/plugin-package-contract`).
- Vendor source: `/Volumes/My Book/Documents/celiums-memory`.
- Memory: Celiums Memory MCP (`mcp__claude_ai_Celiums_Memory__*`).
