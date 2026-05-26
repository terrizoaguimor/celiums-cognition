-- 015_agent_lineage_predecessors.sql — explicit predecessor relationships
--
-- Audit response (May 2026): journal_recall with inherit_from previously
-- accepted any syntactically valid agent_id and returned that agent's
-- journal entries, gated only on AGENT_ID_RE format + an existence check.
-- The tool description framed this as reading "a predecessor model's
-- journal" (Option C of the succession-of-models design) but no actual
-- predecessor relationship was enforced — any caller could read any
-- agent's journal.
--
-- This migration adds the missing authorization layer:
--   • agent_lineage_predecessors records the (heir, predecessor) edges
--     a host operator has explicitly established.
--   • journal_recall checks this table before honoring inherit_from.
--     Format + existence checks remain (defense in depth); the table is
--     the authoritative permit/deny gate.
--   • The relationship is per-user_id so multi-tenant hosts don't share
--     lineage edges across operators.
--
-- Establishment surface: a new MCP tool `journal_establish_predecessor`
-- (operator-only, see mcp/journal-tools.ts) writes rows here. It
-- expects the operator to have already verified that the heir agent
-- is the legitimate successor of the predecessor (e.g. you migrated
-- claude-opus-4-6 → claude-opus-4-7 in your gateway config). This
-- engine does not infer the relationship from version-number text.

CREATE TABLE IF NOT EXISTS agent_lineage_predecessors (
  -- Scoping. Per-user so two operators on the same host can't see
  -- each other's lineage edges.
  user_id              text NOT NULL,

  -- The agent that gains read access to its predecessor's journal.
  heir_agent_id        text NOT NULL,

  -- The agent whose journal becomes readable by the heir.
  predecessor_agent_id text NOT NULL,

  -- Provenance. `established_by` is the agent_id that recorded the
  -- relationship (the gateway operator's agent, usually "main" or a
  -- platform-shell agent). `reason` is free-text from the operator
  -- explaining why this lineage is valid (e.g. "model upgrade",
  -- "rebadged from claude-opus-4-6", "shared persona retrofit").
  established_at       timestamptz NOT NULL DEFAULT now(),
  established_by       text NOT NULL,
  reason               text,

  -- Lifecycle. Operators can revoke a lineage by setting revoked_at
  -- rather than deleting the row, so the audit trail remains intact.
  revoked_at           timestamptz,
  revoked_by           text,

  PRIMARY KEY (user_id, heir_agent_id, predecessor_agent_id)
);

CREATE INDEX IF NOT EXISTS agent_lineage_predecessors_heir_idx
  ON agent_lineage_predecessors (user_id, heir_agent_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE agent_lineage_predecessors IS
  'Explicit (heir, predecessor) edges that authorize cross-agent journal reads via inherit_from. Established by the operator via journal_establish_predecessor. Default (no rows) means zero cross-agent reads.';

COMMENT ON COLUMN agent_lineage_predecessors.revoked_at IS
  'When non-null, the edge is considered revoked. journal_recall does not honor revoked edges. The row is kept so the audit trail of past authorizations is not lost.';
