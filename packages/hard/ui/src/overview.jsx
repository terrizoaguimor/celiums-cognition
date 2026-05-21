/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState, useEffect } from "react";
import {
  fetchHealth, fetchCounts, fetchPillars,
  fetchSparklines, fetchRecent, fetchVersionCheck,
  fetchLimbicState, fetchOperatorStatus,
  pillarMeta, useQuery,
} from "./data.js";
import {
  PageHead, SectionCard, Sparkline, StatusDot, HelpPopover,
  fmtBytes, fmtCount, fmtRelative,
} from "./cc-shell.jsx";

/* Overview tab — landing page. Reads health, counts, pillars, sparklines,
 * recent activity, all live from /api/celiums-cognition/*. */

export function Overview() {
  const healthQ     = useQuery(fetchHealth, []);
  const countsQ     = useQuery(fetchCounts, []);
  const pillarsQ    = useQuery(fetchPillars, []);
  const sparksQ     = useQuery(fetchSparklines, []);
  const recentQ     = useQuery(() => fetchRecent({ limit: 10 }), []);

  const [updateState, setUpdateState] = useState("idle");
  const [latest, setLatest] = useState(null);
  const checkUpdate = async () => {
    setUpdateState("checking");
    try {
      const r = await fetchVersionCheck();
      setLatest(r.latest);
      setUpdateState(r.update_available ? "available" : "uptodate");
    } catch {
      setUpdateState("uptodate");
    }
  };

  const health = healthQ.data;
  const counts = countsQ.data;
  const pillars = pillarsQ.data?.pillars ?? [];
  const sparks = sparksQ.data;
  const recent = recentQ.data?.events ?? [];

  const stack = health?.stack ?? {};
  const stackKeys = Object.keys(stack);
  const upCount = stackKeys.filter((k) => stack[k]?.ok).length;
  const total = stackKeys.length;
  const isHealthy = total > 0 && upCount === total;
  const activity = counts?.activity_24h ?? {};
  const corpusTotal = pillars.reduce((a, p) => a + (p.count || 0), 0);
  const maxPillar = pillars.reduce((m, p) => Math.max(m, p.count || 0), 1);

  return (
    <>
      <PageHead
        eyebrow={health ? `Cognition · v${health.version} · ${health.edition}` : "Cognition"}
        title="Overview"
        sub={<>Stack health, corpus snapshot, and recent cognitive activity.</>}
        actions={
          <>
            {healthQ.loading && <span className="celiums-chip">loading…</span>}
            {!healthQ.loading && (
              <span className={`celiums-chip ${isHealthy ? "green" : ""}`}>
                <span className="celiums-dot" /> {isHealthy ? "healthy" : `${upCount}/${total} up`}
              </span>
            )}
            {health?.installed_at && (
              <span className="celiums-chip">installed {fmtRelative(health.installed_at)}</span>
            )}
          </>
        }
      />

      {/* Agent state — PAD + circadian (live every 15s) */}
      <div style={{ marginBottom: 18 }}>
        <AgentStateCard />
      </div>

      {/* Cognition status — the four U5 metrics surfaced by Fase D's
       *  /operator-status endpoint. Drives the gateway's control-UI
       *  widget too (registerControlUiDescriptor). Polls every 15s
       *  so journal_head stays current as the agent writes. */}
      <div style={{ marginBottom: 18 }}>
        <CognitionStatusCard />
      </div>

      {/* Stack health */}
      <div style={{ marginBottom: 18 }}>
        <SectionCard title="Stack" count={total > 0 ? `${upCount}/${total} up` : "—"}>
          {!health && <SkeletonRows n={4} />}
          {stack.postgres && <StackRow name="Postgres" svc={stack.postgres} extra={stack.postgres.db ?? "memory store"} size={fmtBytes(stack.postgres.size_bytes ?? 0)} />}
          {stack.qdrant   && <StackRow name="Qdrant"   svc={stack.qdrant}   extra="vector store"               size={fmtBytes(stack.qdrant.size_bytes ?? 0)} />}
          {stack.valkey   && <StackRow name="Valkey"   svc={stack.valkey}   extra="cache · pubsub"             size={fmtBytes(stack.valkey.size_bytes ?? 0)} />}
          {stack.tei      && <StackRow name="TEI"      svc={stack.tei}      extra={stack.tei.model ?? "embeddings"} size="—" />}
        </SectionCard>
      </div>

      {/* Sparkline metrics — 24h activity */}
      <div className="cc-grid cols-4" style={{ marginBottom: 18 }}>
        <MiniMetric
          label="memories captured"
          value={activity.memories_captured ?? "—"}
          data={sparks?.memories ?? []}
        />
        <MiniMetric
          label="journal entries"
          value={activity.journal_entries ?? "—"}
          data={sparks?.journal ?? []}
        />
        <MiniMetric
          label="ethics blocks"
          value={activity.ethics_blocks ?? "—"}
          data={sparks?.ethics_blocks ?? []}
        />
        <MiniMetric
          label="ethics flags"
          value={activity.ethics_flags ?? "—"}
          data={sparks?.ethics_flags ?? []}
        />
      </div>

      {/* Counts row */}
      <div className="cc-grid cols-2" style={{ marginBottom: 18 }}>
        <SectionCard title="Corpus" count="total">
          <KV k="Skills"        v={fmtCountSafe(counts?.skills)} />
          <KV k="Memories"      v={fmtCountSafe(counts?.memories)} />
          <KV k="Journal"       v={fmtCountSafe(counts?.journal_entries)} />
          <KV k="Ethics events" v={fmtCountSafe(counts?.ethics_events)} />
        </SectionCard>
        <SectionCard title="Activity · last 24h" count="live">
          <KV k="Memories captured" v={activity.memories_captured ?? "—"} />
          <KV k="Journal entries"   v={activity.journal_entries   ?? "—"} />
          <KV k="Ethics blocks"     v={activity.ethics_blocks     ?? "—"} />
          <KV k="Ethics flags"      v={activity.ethics_flags      ?? "—"} />
        </SectionCard>
      </div>

      {/* Plugin + recent activity */}
      <div className="cc-grid cols-2" style={{ marginBottom: 18 }}>
        <SectionCard title="Plugin" count={health ? `v${health.version}` : "…"} padded>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 10, fontSize: 13 }}>
            <div style={{ color: "var(--c-fg-muted)" }}>Version</div>
            <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>{health?.version ?? "…"}</div>
            <div style={{ color: "var(--c-fg-muted)" }}>Edition</div>
            <div style={{ color: "var(--c-fg)" }}>{health?.edition === "hard" ? "Hard · Postgres + Qdrant + Valkey + TEI" : (health?.edition ?? "…")}</div>
            <div style={{ color: "var(--c-fg-muted)" }}>Seed</div>
            <div style={{ color: "var(--c-fg)" }}>
              {health?.seed
                ? <>{health.seed.version} · {fmtCount(health.seed.row_count ?? 0)} modules</>
                : "not applied"}
            </div>
            <div style={{ color: "var(--c-fg-muted)" }}>Installed</div>
            <div style={{ color: "var(--c-fg)" }}>{health?.installed_at ? fmtRelative(health.installed_at) : "—"}</div>
          </div>

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--c-divider)",
                        display: "flex", alignItems: "center", gap: 12 }}>
            <button className={`celiums-btn ${updateState === "available" ? "primary" : ""}`}
                    onClick={checkUpdate} disabled={updateState === "checking"}>
              {updateState === "checking"  && <>↻ Checking…</>}
              {updateState === "idle"      && <>◯ Check for updates</>}
              {updateState === "uptodate"  && <>↻ Check again</>}
              {updateState === "available" && <>↑ Install v{latest}</>}
            </button>
            <div style={{ fontSize: 12.5, color: "var(--c-fg-muted)", flex: 1 }}>
              {updateState === "idle"      && "Last checked: never"}
              {updateState === "checking"  && "Contacting ClawHub…"}
              {updateState === "uptodate"  && <>Latest is <code style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>v{latest}</code> · you're up to date</>}
              {updateState === "available" && <>A new release <code style={{ fontFamily: "var(--font-mono)", color: "var(--c-green-text)" }}>v{latest}</code> is available.</>}
            </div>
            {updateState === "available" && <span className="celiums-chip green">recommended</span>}
          </div>
        </SectionCard>

        <SectionCard title="Recent activity" count={recent.length}>
          {recentQ.loading && <SkeletonRows n={5} />}
          {!recentQ.loading && recent.length === 0 && (
            <EmptyHint>No activity yet — write your first memory or journal entry.</EmptyHint>
          )}
          {recent.slice(0, 8).map((e, i) => (
            <div key={e.id ?? i} style={{
              display: "grid", gridTemplateColumns: "70px 22px 1fr",
              alignItems: "center", gap: 10,
              padding: "8px 18px", borderBottom: i < Math.min(recent.length, 8) - 1 ? "1px solid var(--c-divider)" : "none",
              fontSize: 12.5,
            }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg-subtle)" }}>{fmtTime(e.ts)}</span>
              <ActivityIcon type={e.type} extra={e.extra} />
              <span style={{ color: "var(--c-fg-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.text}</span>
            </div>
          ))}
        </SectionCard>
      </div>

      {/* Pillar distribution */}
      <SectionCard
        title="Skill corpus by pillar"
        count={`${pillars.length} pillars · ${fmtCount(corpusTotal)}`}>
        <div style={{ padding: "14px 18px" }}>
          {pillarsQ.loading && <SkeletonRows n={6} />}
          {!pillarsQ.loading && pillars.length === 0 && (
            <EmptyHint>No skills loaded yet — apply the seed to populate the corpus.</EmptyHint>
          )}
          {pillars.map((p) => {
            const meta = pillarMeta(p.name);
            return (
              <div className="cc-pillar-row" key={p.name}>
                <div className="name">
                  <span style={{ width: 14, color: "var(--c-fg-muted)", textAlign: "center" }}>{meta.icon}</span>
                  {p.name}
                </div>
                <div className="track"><i style={{ width: `${(p.count / Math.max(maxPillar, 1)) * 100}%`, background: meta.color }} /></div>
                <div className="num">{fmtCount(p.count)}</div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

function fmtCountSafe(n) {
  if (n == null) return "—";
  return fmtCount(n);
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

/* Agent state card — live PAD + circadian. Refetches on mount AND
 * every 15s so `local_hour` and `rhythm` track wall-clock instead of
 * sticking to the initial snapshot (reported by Mario 2026-05-21:
 * the time chip drifted by several minutes after the page was left
 * open). The endpoint is cheap — two PG queries + an in-memory engine
 * call — so a 15s cadence is comfortable. */
export function AgentStateCard() {
  const stateQ = useQuery(fetchLimbicState, []);
  const { refetch } = stateQ;
  useEffect(() => {
    const id = setInterval(() => refetch(), 15_000);
    return () => clearInterval(id);
  }, [refetch]);
  const data = stateQ.data;
  const mood = data?.mood;
  const c = data?.circadian;
  const tz = data?.timezone;

  return (
    <SectionCard
      title="Agent state"
      count={c ? c.time_of_day : "—"}
      action={
        <HelpPopover title="What this shows">
          <p style={{ margin: "0 0 8px" }}>
            Real-time output of the engine's <code>LimbicEngine</code> and
            <code> CircadianEngine</code> for your user_id. Values are
            recomputed fresh-on-read — the rhythm component tracks actual
            time, the PAD axes carry the latest update from the agent's
            interactions.
          </p>
          <ul style={{ margin: "8px 0", paddingLeft: 18, lineHeight: 1.55 }}>
            <li><strong>P/A/D</strong>: Pleasure (−1…+1), Arousal (0…1),
              Dominance (0…1). The agent's affect snapshot RIGHT NOW.</li>
            <li><strong>Rhythm</strong>: the sinusoidal 24h baseline
              (range ~ −0.3…+0.3) before the 12 external factors
              modulate it.</li>
            <li><strong>Time-of-day bucket</strong>: derived from local
              hour using the user_profile timezone. Set yours in Settings
              if it says UTC.</li>
          </ul>
        </HelpPopover>
      }>
      <div style={{ padding: "14px 18px" }}>
        {stateQ.loading && <SkeletonRows n={2} />}
        {!stateQ.loading && !mood && !c && (
          <EmptyHint>
            Engine hasn't computed a limbic state yet. Have a conversation
            with an agent through this gateway to seed it.
          </EmptyHint>
        )}
        {!stateQ.loading && (mood || c) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* PAD axes */}
            <div>
              <div style={{ fontSize: 11, color: "var(--c-fg-subtle)", textTransform: "uppercase",
                            letterSpacing: 0.4, marginBottom: 8, fontFamily: "var(--font-mono)" }}>
                Affect · PAD
              </div>
              {mood ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <PADBar label="pleasure"  value={mood.pleasure} signed />
                  <PADBar label="arousal"   value={mood.arousal} />
                  <PADBar label="dominance" value={mood.dominance} />
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--c-fg-subtle)" }}>— no mood snapshot yet</div>
              )}
            </div>
            {/* Circadian */}
            <div>
              <div style={{ fontSize: 11, color: "var(--c-fg-subtle)", textTransform: "uppercase",
                            letterSpacing: 0.4, marginBottom: 8, fontFamily: "var(--font-mono)" }}>
                Circadian
              </div>
              {c ? (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 8, columnGap: 12, fontSize: 13 }}>
                  <div style={{ color: "var(--c-fg-muted)" }}>time of day</div>
                  <div style={{ color: "var(--c-fg)", fontWeight: 500 }}>
                    {humanizeTimeOfDay(c.time_of_day)}
                  </div>
                  <div style={{ color: "var(--c-fg-muted)" }}>local hour</div>
                  <div style={{ color: "var(--c-fg)", fontFamily: "var(--font-mono)" }}>
                    {Number(c.local_hour).toFixed(2)}
                  </div>
                  <div style={{ color: "var(--c-fg-muted)" }}>rhythm</div>
                  <div style={{ color: "var(--c-fg)", fontFamily: "var(--font-mono)" }}>
                    {c.rhythm.toFixed(3)}
                  </div>
                  <div style={{ color: "var(--c-fg-muted)" }}>arousal post-reg.</div>
                  <div style={{ color: "var(--c-fg)", fontFamily: "var(--font-mono)" }}>
                    {c.arousal_after_regulation.toFixed(3)}
                  </div>
                  <div style={{ color: "var(--c-fg-muted)" }}>timezone</div>
                  <div style={{ color: "var(--c-fg)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {tz?.iana ?? "UTC"}
                    {tz?.iana === "UTC" && (
                      <span style={{ color: "var(--c-amber-text)", marginLeft: 6, fontSize: 11 }}>
                        (set in Settings)
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--c-fg-subtle)" }}>— no rhythm computed</div>
              )}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* Cognition status card — the four U5 metrics from /operator-status:
 * context usage, journal head hash, ethics mode, recall count for last
 * turn. Mirrors the gateway's control-UI widget so the operator sees the
 * same numbers in two places (shell chip + dashboard card). Polls every
 * 15s like AgentStateCard so journal_head stays current.
 */
export function CognitionStatusCard() {
  const statusQ = useQuery(fetchOperatorStatus, []);
  const { refetch } = statusQ;
  useEffect(() => {
    const id = setInterval(() => refetch(), 15_000);
    return () => clearInterval(id);
  }, [refetch]);
  const data = statusQ.data;
  const ctxPct = data?.context_usage_pct;
  const journalHead = data?.journal_head;
  const ethicsMode = data?.ethics_mode ?? "—";
  const recallCount = data?.recall_count_last_turn;

  const modeTone =
    ethicsMode === "enforce" ? "amber" :
    ethicsMode === "off"     ? "red"   :
    ethicsMode === "radar"   ? "green" : "";

  return (
    <SectionCard
      title="Cognition status"
      count={journalHead ? `chain @ ${journalHead.hash.slice(0, 8)}…` : "—"}
      action={
        <HelpPopover title="What this shows">
          <p style={{ margin: "0 0 8px" }}>
            The four operator-side metrics Fase D's <code>registerControlUiDescriptor</code>
            exposes to the OpenClaw shell. Identical values to what the
            agent reports via <code>celiums.status</code> session action.
          </p>
          <ul style={{ margin: "8px 0", paddingLeft: 18, lineHeight: 1.55 }}>
            <li><strong>Context %</strong>: how full the LLM context window is.
              <code> null</code> until the host SDK exposes the signal.</li>
            <li><strong>Journal head</strong>: most recent hash on this agent's
              SHA-chained journal. The continuity anchor — if it changes,
              the agent wrote something new.</li>
            <li><strong>Ethics mode</strong>: <code>off</code> (gate disabled),
              <code> radar</code> (eval + log), <code>enforce</code>
              (strictMode blocks any violation).</li>
            <li><strong>Recall count</strong>: memories pulled into the last
              turn's context. <code>null</code> until the SDK reports it.</li>
          </ul>
        </HelpPopover>
      }>
      <div style={{ padding: "14px 18px" }}>
        {statusQ.loading && !data && <SkeletonRows n={2} />}
        {data && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* Left column: ethics + context */}
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 10, columnGap: 12, fontSize: 13 }}>
              <div style={{ color: "var(--c-fg-muted)" }}>ethics mode</div>
              <div>
                <span className={`celiums-chip ${modeTone}`} style={{ fontFamily: "var(--font-mono)" }}>
                  {ethicsMode}
                </span>
              </div>
              <div style={{ color: "var(--c-fg-muted)" }}>context %</div>
              <div style={{ color: ctxPct == null ? "var(--c-fg-faint)" : "var(--c-fg)", fontFamily: "var(--font-mono)" }}>
                {ctxPct == null ? "— (sdk-pending)" : `${(ctxPct * 100).toFixed(1)}%`}
              </div>
              <div style={{ color: "var(--c-fg-muted)" }}>recall · last turn</div>
              <div style={{ color: recallCount == null ? "var(--c-fg-faint)" : "var(--c-fg)", fontFamily: "var(--font-mono)" }}>
                {recallCount == null ? "— (sdk-pending)" : recallCount}
              </div>
            </div>
            {/* Right column: journal head */}
            <div>
              <div style={{ fontSize: 11, color: "var(--c-fg-subtle)", textTransform: "uppercase",
                            letterSpacing: 0.4, marginBottom: 8, fontFamily: "var(--font-mono)" }}>
                Journal head
              </div>
              {journalHead ? (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 8, columnGap: 12, fontSize: 12.5 }}>
                  <div style={{ color: "var(--c-fg-muted)" }}>id</div>
                  <div style={{ color: "var(--c-fg)", fontFamily: "var(--font-mono)" }}>
                    {String(journalHead.id).slice(0, 12)}…
                  </div>
                  <div style={{ color: "var(--c-fg-muted)" }}>hash</div>
                  <div style={{ color: "var(--c-fg)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                    {String(journalHead.hash).slice(0, 24)}…
                  </div>
                  <div style={{ color: "var(--c-fg-muted)" }}>written</div>
                  <div style={{ color: "var(--c-fg)", fontFamily: "var(--font-mono)" }}>
                    {fmtRelative(journalHead.written_at)}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--c-fg-subtle)" }}>
                  — no journal entries yet for this agent
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function PADBar({ label, value, signed = false }) {
  const v = Math.max(signed ? -1 : 0, Math.min(1, Number(value) || 0));
  const pct = signed ? Math.abs(v) * 50 : v * 100;
  const left = signed ? `${v < 0 ? 50 - pct : 50}%` : "0%";
  const color = signed
    ? v >= 0 ? "var(--c-green)" : "var(--c-red, #ef4444)"
    : "var(--c-green)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 56px", gap: 10, alignItems: "center", fontSize: 12 }}>
      <span style={{ color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)" }}>{label}</span>
      <span style={{
        position: "relative", height: 6, background: "var(--c-divider)", borderRadius: 3,
      }}>
        {signed && (
          <span style={{
            position: "absolute", left: "50%", top: -1, bottom: -1, width: 1,
            background: "var(--c-fg-faint)",
          }} />
        )}
        <span style={{
          position: "absolute", top: 0, bottom: 0, left, width: `${pct}%`,
          background: color, borderRadius: 3,
        }} />
      </span>
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)", textAlign: "right" }}>
        {v.toFixed(2)}
      </span>
    </div>
  );
}

function humanizeTimeOfDay(bucket) {
  const map = {
    "deep-night": "Deep night",
    "morning-rise": "Morning rise",
    "morning-peak": "Morning peak",
    "afternoon-peak": "Afternoon peak",
    "afternoon-decline": "Afternoon decline",
    "evening-wind-down": "Evening wind-down",
    "night-rest": "Night rest",
  };
  return map[bucket] ?? bucket;
}

export function SkeletonRows({ n = 3 }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} style={{
      height: 32, margin: "0 18px", borderBottom: "1px solid var(--c-divider)",
      background: "linear-gradient(90deg, transparent 0%, var(--c-divider) 40%, transparent 80%)",
      backgroundSize: "200% 100%",
      animation: "celiums-shimmer 1.4s ease-in-out infinite",
      opacity: 0.5,
    }} />
  ));
}

export function EmptyHint({ children }) {
  return (
    <div style={{ padding: "14px 18px", color: "var(--c-fg-subtle)", fontSize: 13 }}>
      {children}
    </div>
  );
}

export function StackRow({ name, svc, extra, size }) {
  return (
    <div className="cc-stack-row">
      <StatusDot status={svc.ok ? "ok" : "err"} live={svc.ok} />
      <span className="name">{name}</span>
      <span className="endpoint">{svc.endpoint}</span>
      <span className="extra">{extra}</span>
      <span className="size">{size}</span>
    </div>
  );
}

export function KV({ k, v }) {
  return <div className="cc-kv"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

export function MiniMetric({ label, value, data }) {
  return (
    <div className="celiums-card cc-metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <Sparkline data={data && data.length > 0 ? data : [0]} />
    </div>
  );
}

export function ActivityIcon({ type, extra }) {
  const isBlock = type === "ethics" && (extra === "block" || extra === "blocked");
  const map = {
    memory:  { c: "var(--c-green)",       bg: "var(--c-green-soft)",          ch: "◉" },
    journal: { c: "#5a7fa3",              bg: "rgba(90,127,163,0.15)",        ch: "≡" },
    ethics:  { c: "var(--c-amber-text)",  bg: "var(--c-amber-soft)",          ch: "⚖" },
  };
  const v = isBlock
    ? { c: "var(--c-red-text)", bg: "var(--c-red-soft)", ch: "⊘" }
    : (map[type] ?? map.memory);
  return (
    <span style={{
      width: 22, height: 22, borderRadius: 4, display: "grid", placeItems: "center",
      background: v.bg, color: v.c, fontSize: 11,
    }}>{v.ch}</span>
  );
}
