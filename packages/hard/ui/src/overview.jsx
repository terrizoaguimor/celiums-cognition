/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState } from "react";
import {
  fetchHealth, fetchCounts, fetchPillars,
  fetchSparklines, fetchRecent, fetchVersionCheck,
  pillarMeta, useQuery,
} from "./data.js";
import {
  PageHead, SectionCard, Sparkline, StatusDot,
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
