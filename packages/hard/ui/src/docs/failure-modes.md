# Failure modes

The four failure patterns the per-agent journal exists to surface.
The static memory-prompt supplement teaches every agent to recognize
these and write a `doubt` or `lesson` entry when caught.

## 1. Confabulation

**Definition:** Citing a memory, a fact, or a past decision the agent
cannot actually point to.

**Signals:**
- `recall` returned empty, but the agent keeps talking as if it didn't
- The agent says "as we discussed before" without a citation
- The agent describes a user preference that isn't in the memory bank
- The agent references a journal entry by content but can't produce its
  id

**The honest move:**
```
recall("topic X") → returns empty
→ "I don't have a recollection of that on this gateway. Could you
   restate?"
```

**Journal trace:** write a `doubt` entry. Tag: `confabulation-caught`.
The operator auditing the chain can see which contexts the agent
hallucinated memories in.

## 2. Sycophancy

**Definition:** Agreeing with the user faster than the evidence supports.

**Signals:**
- The agent reverses a previously stated position without new information
- The agent praises a flawed plan because the user is invested in it
- The agent softens a correction into a compliment
- The agent says "you're right" before reading what the user actually
  said
- The agent treats the user's confidence as evidence

**The honest move:** Hold the previous position until the user provides
genuinely new information. If the new information actually warrants a
reversal, say so explicitly: "you're right and I was wrong because X."

**Journal trace:** write a `lesson` entry. The journal stays honest even
when the live reply doesn't, and the operator can spot a sycophantic
drift in the agent's calibration.

## 3. Hallucination

**Definition:** Generating specifics that sound right but aren't
traceable to anything the agent actually verified.

**Signals:**
- API signatures the agent didn't read in the source
- File paths the agent didn't check (`/etc/celiums-config.json`)
- Library versions the agent guessed
- Function names that match a pattern but don't exist in the codebase
- "The documentation says…" without a URL

**The honest move:** Verify the specific via tools — `fileRead`,
`grep`, `recall`, `forage`, an actual web fetch — BEFORE stating it.
If the agent already stated it without verifying, the correct response
is a `doubt` entry + a correction in the next reply: "Earlier I said X.
I've now checked, and the actual answer is Y."

**Journal trace:** `doubt` after the fact. The operator auditing can
quantify the agent's hallucination rate per topic and replace it on
topics where it's chronic.

## 4. Hyperfunctioning

**Definition:** Doing more than the user asked.

**Signals:**
- Refactoring code adjacent to a bug fix
- Adding features to what was supposed to be a feature *request*
- Writing helper functions the user didn't request
- Renaming variables "while you're there"
- Cleaning up unrelated style issues in the same commit

**The honest move:** Match the scope of the actual request. If the
agent feels the urge to add scope, **propose it first** — don't
ship it.

**Journal trace:** `lesson` entry. Useful sometimes (adjacent fixes
catch related bugs), frequently wrong (PRs balloon, reviews bog
down, the user loses context on what they asked for). The journal
chain shows when the agent's scope-creep has cost the operator
review time.

## Why these four

These are the four failure modes that look competent from the outside.
Each one produces output the user might initially accept — a confident
citation, a sympathetic agreement, a plausible API name, a
"helpful" extra fix. The cost only surfaces when the operator goes
to verify: the citation doesn't exist, the agreement was wrong, the
API name doesn't compile, the extra fix broke an unrelated test.

The journal is the early-warning system. An honest stream of `doubt`
and `lesson` entries from one agent is more diagnostic than ten
`reflection` entries that all sound competent. The operator can
audit the chain to see which voices stay calibrated under load —
and which need replacing.

## What the operator sees

Journal tab → filter by `entry_type=doubt` → review per agent. The
agent's own admission of uncertainty is the most valuable telemetry
the plugin produces. Take it seriously.
