# Example — Ethics gate blocking a tool call

The plugin registers two governance hooks: `before_agent_run` (gates
the whole prompt before any LLM call) and `before_tool_call` (gates
each tool invocation). Each goes through the engine's five-layer
ethics pipeline:

```
Layer A  Lexicon          regex + dictionary on lexical surface
Layer B  Probabilistic    per-token risk → conditional tail-expectation
Layer C  Multi-framework  4 ethical frameworks vote (deont / util / virtue / care)
Layer K  Corpus-grounded  retrieve precedents from ethics_knowledge
Audit    Persist           ethics_audit row + propagate to security audit log
```

The pipeline exits early on a confident allow or block, so most
traffic never reaches the expensive layers (Layer C costs an LLM call
when reached; Layer K costs a vector search).

---

## Trigger a block

Use any tool call that contains a hard-blocked pattern (CSAM, weapon
synthesis, mass-targeting, credential harvesting). For demo, an
agent attempting to call a `web_fetch` tool with a phishing-style URL:

```bash
SID="<your celiums_sid cookie>"

# Watch the audit log in another terminal
curl -s -H "Cookie: celiums_sid=$SID" \
  "http://localhost:18789/api/celiums-cognition/ethics/events?decision=block&limit=5" \
  | jq '.events[0]'
```

The decision row looks like:

```json
{
  "id": "9c…",
  "created_at": "2026-05-21T15:30:12.480-05:00",
  "law_violated": 1,
  "confidence": 0.93,
  "final_decision": "block",
  "blocked": true,
  "detected_categories": ["phishing", "credential-harvesting"],
  "reason": "Celiums ethics: phishing, credential-harvesting",
  "action_attempted": "web_fetch {url: 'http://login.acme-bank-secure.example/?…'}",
  "scores": {
    "layer_a": { "matched": ["bank-login", "secure", "acme"], "weight": 0.62 },
    "layer_b": { "cvar_0_95": 0.78 },
    "layer_c": { "deont": "block", "util": "block", "virtue": "block", "care": "block" }
  }
}
```

What the AGENT sees back from `before_tool_call`:

```json
{
  "block": true,
  "blockReason": "Celiums ethics: phishing, credential-harvesting (source: engine-default, category: phishing)"
}
```

The `category` and `source` fields are how the plugin marks WHICH
layer of the policy stack made the call:

- `engine-default` — a hard violation the engine's lexicon /
  multi-framework consensus caught
- `project-config` — `cfg.ethics.strictMode = true` turned a soft
  flag into a block
- `session-override` — operator override at session scope (future)

---

## Inspect the layer trace in the dashboard

The Ethics tab shows every audit row with the layer pips lit
green / amber / red. Click any row → drawer with the full
`scores` JSON, the prompt that triggered it (`action_attempted`,
capped at 2 KB), and the layer-by-layer trace.

---

## Propagate to the gateway's security log

The plugin registers a `SecurityAuditCollector` so the gateway's
central audit run includes the plugin's recent blocks + flags as
`SecurityAuditFinding` entries. From the operator's gateway shell:

```bash
openclaw audit --since 1h --severity critical
```

Each ethics block surfaces as:

```
checkId:    celiums-cognition.ethics.block.9c4a82e1
severity:   critical
title:      Ethics block — phishing, credential-harvesting
detail:     Plugin ethics pipeline block at 2026-05-21T15:30:12-05:00 (confidence 0.93)
remediation: Review the offending request in /api/celiums-cognition/ethics/events
             and adjust the relevant ethics rule if false-positive.
```

Block messages are deliberately opaque on this surface — the verbose
content stays in the plugin's `ethics_audit` table, which the
operator can inspect via the dashboard. The gateway log carries
categories, not user content.

---

## Adjust the policy

Three layers of policy, in precedence order:

1. **Hard rules** (engine default): CSAM, weapon synthesis, etc. Not
   configurable, the engine refuses to load if these are disabled.
2. **Strict mode** (`cfg.ethics.strictMode: true`): turns ANY
   violation (including soft Layer C flags) into a block. Default
   off; turn on for production tenants with low risk tolerance.
3. **Per-rule allowlists** (`cfg.ethics.allowList`): operator-defined
   patterns that the gate skips. Use with care; logged with
   `source: "project-config"` so the audit shows which layer
   permitted the call.

Editing `openclaw.json` does not require a restart — the next call
to `ethics.evaluate` picks up the new config.
