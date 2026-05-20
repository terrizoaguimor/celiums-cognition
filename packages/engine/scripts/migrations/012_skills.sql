-- Copyright 2026 Celiums Solutions LLC
-- Licensed under the Apache License, Version 2.0
-- Originally derived from celiums-memory v2.0
-- (https://github.com/terrizoaguimor/celiums-memory, Apache 2.0)
--
-- Migration 012: skills table schema (matches the canonical celiums-memory
-- production schema in DB `celiums`, dumped 2026-05-20 from the
-- DOKS-hosted cluster). 28 columns + HNSW vector index + GIN trigram +
-- FTS, plus the skills_search_tsv() helper function the generated tsv
-- column depends on.
--
-- The upstream celiums-memory repo does NOT ship this migration (the
-- corpus table is managed by Mario's harvester pipeline outside the
-- migrations runner). We vendor it here so the plugin Hard edition has
-- a schema compatible with the seed snapshot (CELIUMS_SEED_URL) and
-- with a future federation to memory.celiums.ai.
--
-- Idempotent: pre-existing `skills` tables created by earlier minimal
-- bootstraps are dropped and recreated (the migration runner will not
-- reach this step a second time because of celiums_migrations tracking,
-- so the DROP only fires on the very first apply). The function is
-- CREATE OR REPLACE.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── helper function (referenced by the generated search_tsv column) ─

CREATE OR REPLACE FUNCTION public.skills_search_tsv(
  name text,
  display_name text,
  description text,
  keywords text[]
) RETURNS tsvector
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
         setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
         setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
         setweight(to_tsvector('english', coalesce(array_to_string(keywords, ' '), '')), 'C');
$function$;

-- ─── skills table ───────────────────────────────────────────────────

-- Drop any earlier minimal schema (this migration is the first one to
-- create `skills`; if it already exists from a hand-built bootstrap, the
-- pre-existing rows were either zero or transient).
DROP TABLE IF EXISTS public.skills CASCADE;

CREATE TABLE public.skills (
  name                 character varying(100) NOT NULL,
  display_name         character varying(200) NOT NULL,
  description          text DEFAULT ''::text NOT NULL,
  category             character varying(255) DEFAULT 'meta'::character varying NOT NULL,
  keywords             text[] DEFAULT '{}'::text[] NOT NULL,
  content              text NOT NULL,
  line_count           integer DEFAULT 0 NOT NULL,
  has_references       boolean DEFAULT false NOT NULL,
  reference_count      integer DEFAULT 0 NOT NULL,
  eval_score           numeric(3,1),
  eval_verdict         character varying(100),
  eval_date            timestamp with time zone,
  grounded             boolean DEFAULT false NOT NULL,
  grounded_date        timestamp with time zone,
  source_count         integer DEFAULT 0 NOT NULL,
  created_at           timestamp with time zone DEFAULT now() NOT NULL,
  updated_at           timestamp with time zone DEFAULT now() NOT NULL,
  allowed_tools        text DEFAULT ''::text,
  context_mode         text DEFAULT 'fork'::text,
  agent_type           text DEFAULT 'general-purpose'::text,
  version              text DEFAULT '2.0'::text,
  embedding            public.vector(1024),
  search_tsv           tsvector GENERATED ALWAYS AS (
    public.skills_search_tsv(
      (name)::text,
      (display_name)::text,
      description,
      keywords
    )
  ) STORED,
  pillar               text,
  subcat               text,
  provenance_status    text,
  provenance_marked_at timestamp with time zone,
  CONSTRAINT skills_pkey PRIMARY KEY (name)
);

-- ─── indexes ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_skills_category
  ON public.skills USING btree (category);

CREATE INDEX IF NOT EXISTS idx_skills_category_name
  ON public.skills USING btree (category, name)
  INCLUDE (display_name, description, eval_score);

CREATE INDEX IF NOT EXISTS idx_skills_display_name_trgm
  ON public.skills USING gin (display_name public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_skills_embedding_hnsw
  ON public.skills USING hnsw (embedding public.vector_cosine_ops)
  WITH (m = '32', ef_construction = '128');

CREATE INDEX IF NOT EXISTS idx_skills_keywords_gin
  ON public.skills USING gin (keywords);

CREATE INDEX IF NOT EXISTS idx_skills_name_trgm
  ON public.skills USING gin (name public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_skills_search
  ON public.skills USING gin (
    to_tsvector('english'::regconfig, (((name)::text || ' '::text) || description))
  );

CREATE INDEX IF NOT EXISTS idx_skills_search_tsv
  ON public.skills USING gin (search_tsv);

CREATE INDEX IF NOT EXISTS idx_skills_unevaluated
  ON public.skills USING btree (created_at DESC)
  WHERE (eval_score IS NULL);

CREATE INDEX IF NOT EXISTS skills_pillar_idx
  ON public.skills USING btree (pillar);

CREATE INDEX IF NOT EXISTS skills_pillar_subcat_idx
  ON public.skills USING btree (pillar, subcat);

CREATE INDEX IF NOT EXISTS skills_subcat_idx
  ON public.skills USING btree (subcat);

COMMENT ON TABLE public.skills IS
  'Curated skills/knowledge corpus. Populated by the SeedManager from a '
  'sha256-pinned snapshot at CELIUMS_SEED_URL, or left empty for operators '
  'that federate to a hosted knowledge backend via KNOWLEDGE_API_URL.';
