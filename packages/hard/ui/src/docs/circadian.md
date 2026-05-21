# Circadian

The agent has its own biological clock — a continuous arousal baseline
modulated by 12+ factors, not just a simple sinusoid.

## The formula

```
A(t) = A₀ + C · sin(2π(τ − φ)/24) · e^(−λ Δt) + Σ wᵢ · Fᵢ(t)
```

- `A₀` — baseline arousal (`base_arousal`, default 0.0)
- `C` — amplitude (`amplitude`, default 0.3)
- `τ` — local hour in the user's timezone
- `φ` — peak hour (`peak_hour`, default 11 — morning cortisol awakening
  response peak)
- `λ` — lethargy decay rate (`lethargy_rate`, default 0.15)
- `Δt` — hours since last interaction (sleep debt proxy)
- `Σ wᵢ · Fᵢ(t)` — weighted sum of 12 external factors

The sinusoidal component is the **rhythm** — what you see as
`rhythm=…` in every `remember` / `recall` response. The factors modulate
above or below the rhythm.

## The 12 factors

| # | Factor | Trigger |
|---|---|---|
| 1 | `session_activity` | active user engagement |
| 2 | `stress` | error rate (cortisol proxy) |
| 3 | `social_interaction` | messages exchanged entrain rhythm |
| 4 | `caffeine` | user mentioned coffee/energy |
| 5 | `sleep_debt` | hours since last consolidation |
| 6 | `cognitive_load` | task complexity accumulates fatigue |
| 7 | `emotional_events` | dopamine reward spikes from `remember` |
| 8 | `seasonal` | day-of-year, hemisphere |
| 9 | `temperature` | server/hardware temperature |
| 10 | `isolation` | hours without interaction → decoupling |
| 11 | `exercise` | CPU-intensive work — "workout" proxy |
| 12 | `motivation_trend` | improving or declining trajectory |

The engine updates factors in the background as events fire — the
operator never injects them manually; the plugin reads from
`agent_end`, `tool_result_persist`, and similar hooks.

## Time-of-day buckets

`classifyTimeOfDay(localHour)`:

| Hour range | Bucket |
|---|---|
| < 5  | `deep-night` |
| 5–8  | `morning-rise` |
| 9–11 | `morning-peak` |
| 12–14 | `afternoon-peak` |
| 15–17 | `afternoon-decline` |
| 18–20 | `evening-wind-down` |
| 21–23 | `night-rest` |

The bucket reflects the **user's** local time, derived from
`user_profiles.timezone_iana`. The agent's job is to calibrate tone
to it — at `morning-peak` lean into complexity; at `evening-wind-down`
de-escalate, expect shorter follow-ups.

## Independence

The AI has its OWN rhythm. `syncWithUser: true` (default) entrains it
to the user's timezone — when the user travels, the AI can "travel
along" or "stay home" based on `userTimezoneOffset`. This isn't
cosmetic: a desynced rhythm means the agent's energy curve won't
match the operator's, which the operator will feel as "the AI is
sluggish today" or "weirdly chipper at midnight".

## Setting your timezone

Settings tab → Timezone section. The dashboard offers a "Use browser
(<your-local-tz>)" one-click button and a searchable IANA list (~440
zones). Selection persists to `user_profiles.timezone_iana` +
`timezone_offset`; the engine re-reads on the next telemetry pull,
no restart needed.

If the timezone stays at UTC (default for the VPS clock), every
"good morning" the agent senses fires at the wrong wall-clock time.

## How it surfaces

Every `remember` / `recall` response ends with:

```
Mood: P=0.16 A=-0.21 D=0.14 · Circadian: night-rest (local 21.0h, rhythm=-0.87)
```

- **Mood** — engine's PAD snapshot RIGHT NOW. Calibrate tone, don't
  announce.
- **Circadian** — the bucket + the local hour + the raw rhythm value
  (signed, typically −0.3…+0.3 before factors modulate).

The Overview tab's "Agent state" card renders the same data
visually: PAD bars + circadian sub-card.
