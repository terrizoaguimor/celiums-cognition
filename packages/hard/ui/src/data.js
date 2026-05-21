/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

/* ─────────────────── API base + low-level helper ─────────────────── */

const API_BASE = "/api/celiums-cognition";

/**
 * Fetch JSON from the plugin backend. Always sends cookies (credentials:
 * "include"). Throws an Error with `.status` and `.code` on non-2xx so
 * callers can branch on auth failures (401 → re-show login).
 */
export async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
    method: opts.method ?? "GET",
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* empty body OK */ }
  if (!res.ok) {
    const err = new Error(parsed?.error?.message ?? `HTTP ${res.status}`);
    err.status = res.status;
    err.code = parsed?.error?.code ?? "HTTP_ERROR";
    err.payload = parsed;
    throw err;
  }
  return parsed;
}

/* ─────────────────── Auth fetchers ─────────────────── */

export const authMe        = ()         => apiFetch("/auth/me");
export const authSignup    = body       => apiFetch("/auth/signup",      { method: "POST", body });
export const authTotpVerify = code      => apiFetch("/auth/totp/verify", { method: "POST", body: { code } });
export const authLogin     = body       => apiFetch("/auth/login",       { method: "POST", body });
export const authLoginTotp = body       => apiFetch("/auth/login/totp",  { method: "POST", body });
export const authLogout    = ()         => apiFetch("/auth/logout",      { method: "POST" });

/* ─────────────────── Data fetchers ─────────────────── */

export const fetchHealth         = ()         => apiFetch("/health");
export const fetchCounts         = ()         => apiFetch("/counts");
export const fetchPillars        = ()         => apiFetch("/pillars");
export const fetchVersionCheck   = ()         => apiFetch("/version-check");

function qs(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item == null || item === "") continue;
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`);
      }
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.length === 0 ? "" : "?" + parts.join("&");
}
export const fetchSkills       = (params) => apiFetch(`/skills${qs(params)}`);
export const fetchSkill        = (name)   => apiFetch(`/skills/${encodeURIComponent(name)}`);
export const fetchMemories     = (params) => apiFetch(`/memories${qs(params)}`);
export const fetchJournal      = (params) => apiFetch(`/journal/recent${qs(params)}`);
export const fetchJournalAgents = ()      => apiFetch("/journal/agents");
export const fetchEthicsEvents = (params) => apiFetch(`/ethics/events${qs(params)}`);
export const fetchSparklines   = ()       => apiFetch("/activity/sparklines");
export const fetchRecent       = (params) => apiFetch(`/activity/recent${qs(params)}`);
export const fetchLimbicState  = ()       => apiFetch("/limbic-state");
export const fetchTimezones    = ()       => apiFetch("/timezones");
export const fetchSettingsTimezone = ()   => apiFetch("/settings/timezone");
export const saveSettingsTimezone  = (iana) => apiFetch("/settings/timezone", { method: "PUT", body: { iana } });

/* ─────────────────── useQuery hook ─────────────────── */

/**
 * Tiny query hook: `useQuery(() => fetchX(), [deps])` returns
 * { data, error, loading, refetch }. Cancels stale results with an
 * AbortController so a slow-then-fast sequence doesn't paint stale data.
 *
 * Intentionally minimal — no global cache, no retries, no stale-while-
 * revalidate. The dashboard refreshes at a user-driven cadence (per-tab
 * navigation or explicit refetch). Adding React Query later is one
 * import swap if we outgrow this.
 */
export function useQuery(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const runIdRef = useRef(0);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    const myRun = ++runIdRef.current;
    Promise.resolve(fn())
      .then((d) => {
        if (myRun !== runIdRef.current || !mountedRef.current) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (myRun !== runIdRef.current || !mountedRef.current) return;
        setError(e);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  return { data, error, loading, refetch: run };
}

/* ─────────────────── Static presentation ─────────────────── */

/* Visual identity for each pillar — ordered for stable list rendering.
 * Live counts come from /pillars endpoint; this map only carries
 * color + icon. Keep aligned with the seed corpus categories
 * (curated in celiums-memory v2.0 — 10 pillars × 1000 modules each). */
export const PILLAR_META = {
  "ai-ml":                  { color: "#a78bfa", icon: "🧠" },
  "backend":                { color: "#60a5fa", icon: "⚙" },
  "frontend":               { color: "#34d399", icon: "◐" },
  "mobile":                 { color: "#f472b6", icon: "▢" },
  "devops":                 { color: "#fbbf24", icon: "⎈" },
  "database":               { color: "#22d3ee", icon: "≋" },
  "security":               { color: "#fb7185", icon: "⛨" },
  "cognitive-patterns":     { color: "#c4b5fd", icon: "✦" },
  "epistemic-practices":    { color: "#86efac", icon: "⌬" },
  "human-ai-collaboration": { color: "#fdba74", icon: "⚒" },
  // Fallback for any pillar present in the corpus but not enumerated above:
  "_default":               { color: "#9ca3af", icon: "•" },
};

export function pillarMeta(name) {
  return PILLAR_META[name] ?? PILLAR_META._default;
}

/* Backwards-compat for components that imported PILLARS / PILLAR_ICONS:
 * derive both from the meta map. Counts here are zero — components must
 * fetch real counts from /pillars. */
export const PILLARS = Object.keys(PILLAR_META)
  .filter((k) => k !== "_default")
  .map((name) => ({ name, count: 0, color: PILLAR_META[name].color }));
export const PILLAR_ICONS = Object.fromEntries(
  Object.entries(PILLAR_META).map(([k, v]) => [k, v.icon]),
);

/* Drawer placeholder content shown while a skill body is loading. */
export const SAMPLE_CONTENT = `# {title}

Loading skill content from the corpus…
`;

/* The 5-layer ethics pipeline structure — used by the Ethics tab to
 * render the architecture diagram. Latencies/percentages are illustrative
 * defaults; the actual layer-by-layer trace will come from
 * /api/celiums-cognition/ethics/events records (each event lists which
 * layers fired). */
export const ETHICS_PIPELINE = [
  { name: "Lexicon (Layer A)",       desc: "Fast regex + dictionary match on lexical surface",   pct: "100% of requests" },
  { name: "Probabilistic CVaR (B)",  desc: "Per-token risk → conditional tail expectation",      pct: "≈ 10–15%" },
  { name: "Multi-framework LLM (C)", desc: "deontological + utilitarian + virtue + care",        pct: "≈ 2–4%" },
  { name: "Corpus-grounded (K)",     desc: "Vector retrieval against ethics_knowledge",          pct: "≈ 0.5–1%" },
  { name: "Audit (final)",           desc: "Persists block/flag rows in ethics_audit",           pct: "all decisions" },
];

/* Settings tab — structured view of the environment variables the plugin
 * honors. Pure presentation; values come from /api/celiums-cognition/
 * settings (TODO endpoint) once we expose runtime introspection. For now
 * the UI shows the schema with placeholder values. */
export const ENV_GROUPS = [
  { id: "stack", label: "Stack endpoints", icon: "⌬", items: [
    { key: "CELIUMS_DATABASE_URL", desc: "Postgres connection URL",       kind: "secret", placeholder: "postgresql://celiums:***@127.0.0.1:5432/celiums_memory" },
    { key: "CELIUMS_QDRANT_URL",   desc: "Qdrant HTTP endpoint",          kind: "text",   placeholder: "http://127.0.0.1:6333" },
    { key: "CELIUMS_VALKEY_URL",   desc: "Valkey/Redis cache + pubsub",   kind: "text",   placeholder: "redis://127.0.0.1:6379" },
    { key: "TEI_URL",              desc: "Text-Embeddings-Inference URL", kind: "text",   placeholder: "http://127.0.0.1:8080" },
  ]},
  { id: "seed", label: "Seed & corpus", icon: "✦", items: [
    { key: "CELIUMS_SEED_URL",     desc: "Curated 10k skills seed",       kind: "text",   placeholder: "https://celiums-seed-public.nyc3.digitaloceanspaces.com/seed/seed-skills-v1.sql.gz" },
    { key: "KNOWLEDGE_API_URL",    desc: "Federate to full corpus",       kind: "text",   placeholder: "https://memory.celiums.ai" },
    { key: "KNOWLEDGE_API_KEY",    desc: "API key for federated corpus",  kind: "secret", placeholder: "ck_live_…" },
  ]},
  { id: "ethics", label: "Ethics pipeline", icon: "⚖", items: [
    { key: "ETHICS_ENABLED",         desc: "Master switch",                          kind: "toggle" },
    { key: "ETHICS_CVAR_THRESHOLD",  desc: "Escalation threshold",                   kind: "text", placeholder: "0.55" },
    { key: "ETHICS_BLOCK_THRESHOLD", desc: "Automatic block threshold",              kind: "text", placeholder: "0.85" },
    { key: "ETHICS_FRAMEWORKS",      desc: "Frameworks consulted at the LLM layer", kind: "text", placeholder: "deontological,utilitarian,virtue,care" },
  ]},
  { id: "security", label: "Security", icon: "⛨", items: [
    { key: "SESSION_TTL_MIN",   desc: "Operator session timeout (minutes)",  kind: "text",   placeholder: "1440" },
  ]},
];
