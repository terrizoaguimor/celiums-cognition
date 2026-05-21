# Example — Auto-recall on every turn

The plugin's `before_prompt_build` hook composes a structured block
of context and prepends it to the agent's system prompt **before
every turn**, with no explicit tool call from the model. The block
contains up to eight channels:

```
1. Identity preamble        — who this agent is (agent_id, session_id)
2. Subagent briefing        — when the agent is a registered child
3. Auto-recalled memories   — top semantic + chronological hits
4. Forage corpus snippets   — relevant skills from the knowledge corpus
5. Ethics advisory          — soft hints when CVaR or Layer A flags
6. Epistemic-flag notes     — when retrieval confidence is low
7. Suggestion intents       — recurring patterns the limbic engine spotted
8. Limbic PAD snapshot      — the agent's felt state right now
```

Each channel is independent and short-circuited if it has nothing to
contribute. The composer is token-budgeted to ~3000 chars total.

---

## See what the agent sees

The dashboard ships with a `/preview-prompt` diagnostic endpoint that
invokes the same composer the real hook uses and returns the
assembled text, so you can inspect any user message before the agent
does.

```bash
SID="<your celiums_sid cookie>"

curl -s -H "Cookie: celiums_sid=$SID" \
  "http://localhost:18789/api/celiums-cognition/preview-prompt?msg=$(jq -rn --arg m 'what did we talk about yesterday?' '$m|@uri')" \
  | jq .
```

A typical response:

```json
{
  "user_message": "what did we talk about yesterday?",
  "tools_mode": "curated",
  "identity_preamble": "You are agent `main` on session sess-7a4f… ...",
  "static_supplement": {
    "lines": ["## Memory tools — recall(query)", "## Journal tools ...", "..."],
    "total_chars": 1840
  },
  "dynamic_turn_context": {
    "prependContext": "## Recalled memories\n\n1. ...\n\n## Forage corpus\n\n- ...\n\n## Limbic snapshot\nPAD=(0.15, 0.30, 0.12), morning-peak, rhythm=0.99",
    "total_chars": 1420,
    "error": null
  },
  "composed": {
    "text": "<identity>\n\n<dynamic>\n\n<static>",
    "total_chars": 3380
  }
}
```

`composed.text` is what an LLM would actually see as its system
prompt for this turn.

---

## Adjust the channels per-agent

Each channel is gated by a capability flag the adapter resolves from
env at start. Without the capability, the channel is silently
skipped:

| Channel | Required capability |
|---|---|
| Identity preamble | always present |
| Subagent briefing | engine + `agent_lineage` row for this child |
| Recalled memories | `opencore: true` (default) |
| Forage corpus | `opencore: true` (skills table populated) |
| Ethics advisory | `ai: !!CELIUMS_LLM_API_KEY` |
| Epistemic-flag notes | `opencore: true` |
| Suggestion intents | `opencore: true` |
| Limbic snapshot | engine present |

The Atlas-routed channels (federated forage, suggestion-intents
running on a remote model) require `atlas: !!CELIUMS_ATLAS_API_KEY`.
Without those env vars set, the composer skips them and the agent
sees a smaller — but still working — turn_context.

---

## Disable per-turn auto-recall

If you want to bypass auto-recall entirely (e.g. running an eval
suite that should NOT see memories), flip the config:

```jsonc
// openclaw.json under "plugins.celiums-cognition"
{
  "autoRecall": { "enabled": false }
}
```

The hook is removed at register time when this flag is false —
nothing fires, no DB reads, no cost. The model has to call
`turn_context` explicitly as a tool if it wants the same data.
