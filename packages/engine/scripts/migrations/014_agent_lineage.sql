-- 014_agent_lineage.sql — parent ↔ subagent relationships
--
-- Fase B of the transversal roadmap (docs/transversal-roadmap.md):
-- OpenClaw exposes subagent_spawning/spawned/ended hooks but does NOT
-- pass `parent_session_key` in the spawn event. We track the
-- relationship ourselves here, both for:
--   (a) loop-guard — count the ancestral depth before allowing a spawn
--   (b) live re-briefing — given a child, find its parent's recent
--       journal entries to inject into turn_context
--   (c) operator audit — see which subagents each agent spawned, with
--       outcomes and durations
--
-- Schema is intentionally narrow: identity columns + lifecycle
-- timestamps + outcome. The reflective content lives in agent_journal
-- (same DB), linked here only by agent_id; we don't duplicate prose.

CREATE TABLE IF NOT EXISTS agent_lineage (
  -- Surrogate id; the natural key is (child_agent_id, child_session_key)
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  parent_agent_id     text NOT NULL,
  child_agent_id      text NOT NULL,
  child_session_key   text NOT NULL,

  -- Conversation grouping shared between parent and child entries in
  -- agent_journal — lets the dashboard render the parent's "spawn"
  -- decision and the child's chain in one thread.
  conversation_id     uuid,

  -- The task label OpenClaw passed at spawn time (optional in the SDK).
  task_label          text,

  -- "run" = one-shot, "session" = ongoing thread.
  mode                text NOT NULL CHECK (mode IN ('run', 'session')),

  -- Depth from the root agent (= main = 1). A subagent of a subagent
  -- has depth 3. cfg.subagent.maxDepth rejects beyond this.
  depth               integer NOT NULL DEFAULT 1 CHECK (depth >= 1),

  -- Lifecycle timestamps.
  spawned_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,

  -- Outcome populated when subagent_ended fires. Mirrors the SDK's
  -- enum exactly (PluginHookSubagentEndedEvent.outcome).
  end_outcome         text CHECK (
    end_outcome IS NULL
    OR end_outcome IN ('ok', 'error', 'timeout', 'killed', 'reset', 'deleted')
  ),
  end_summary         text,    -- copy of the child's final arc entry, denormalized for the operator dashboard
  end_error           text     -- error message when end_outcome = 'error'
);

-- Natural uniqueness — the same child can only end once.
CREATE UNIQUE INDEX IF NOT EXISTS agent_lineage_child_uniq
  ON agent_lineage (child_agent_id, child_session_key);

-- Fast lookup "what did this agent spawn recently".
CREATE INDEX IF NOT EXISTS agent_lineage_parent_spawned_at
  ON agent_lineage (parent_agent_id, spawned_at DESC);

-- Fast lookup "what's the ancestry of this session" (loop guard).
CREATE INDEX IF NOT EXISTS agent_lineage_child_session
  ON agent_lineage (child_session_key);

COMMENT ON TABLE agent_lineage IS
  'parent ↔ subagent relationships (Fase B). Populated by the plugin from OpenClaw subagent_* hooks; the SDK does not persist this by default.';
