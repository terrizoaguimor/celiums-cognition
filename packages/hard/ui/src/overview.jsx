import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
import { PILLARS, PILLAR_ICONS, RECENT_ACTIVITY, SPARK_BLOCKS, SPARK_FLAGS, SPARK_JOURNAL, SPARK_MEMORIES } from './data.js';
import { PageHead, SectionCard, Sparkline, StatusDot } from './cc-shell.jsx';
import { Skills } from './skills.jsx';
import { Memories } from './memories.jsx';
import { Journal } from './journal.jsx';
import { Ethics } from './ethics.jsx';
/* Overview tab — landing page. */

export function Overview({ health, counts, showToast }) {
  const [updateState, setUpdateState] = useState("idle");
  const [latest, setLatest] = useState(null);

  const checkUpdate = () => {
    setUpdateState("checking");
    setTimeout(() => {
      const r = Math.random();
      if (r > 0.65) { setUpdateState("available"); setLatest("0.2.0"); }
      else          { setUpdateState("uptodate");  setLatest(health.version); }
    }, 900);
  };

  const stack = health.stack;
  const upCount = Object.values(stack).filter(s => s.ok).length;
  const total   = Object.keys(stack).length;

  return (
    <>
      <PageHead
        eyebrow="Cognition · v0.1.0 · hard"
        title="Overview"
        sub={<>Stack health, corpus snapshot, and recent cognitive activity. <span style={{ color: "var(--c-fg)" }}>Polled every 5 seconds while this tab is visible.</span></>}
        actions={
          <>
            <span className="celiums-chip green"><span className="celiums-dot" /> healthy</span>
            <span className="celiums-chip">installed {fmtRelative(health.installed_at)}</span>
          </>
        }
      />

      {/* Stack health */}
      <div style={{ marginBottom: 18 }}>
        <SectionCard title="Stack" count={`${upCount}/${total} up`}>
          <StackRow name="Postgres" svc={stack.postgres} extra={stack.postgres.db} size={fmtBytes(stack.postgres.size_bytes)} />
          <StackRow name="Qdrant"   svc={stack.qdrant}   extra="vector store" size={fmtBytes(stack.qdrant.size_bytes)} />
          <StackRow name="Valkey"   svc={stack.valkey}   extra="cache · pubsub" size={fmtBytes(stack.valkey.size_bytes)} />
          <StackRow name="TEI"      svc={stack.tei}      extra={stack.tei.model} size="—" />
        </SectionCard>
      </div>

      {/* Sparkline metrics */}
      <div className="cc-grid cols-4" style={{ marginBottom: 18 }}>
        <MiniMetric label="memories"      value={counts.activity_24h.memories_captured} delta="+2"  data={MOCK_DATA.SPARK_MEMORIES} />
        <MiniMetric label="journal"       value={counts.activity_24h.journal_entries}   delta="+3"  data={MOCK_DATA.SPARK_JOURNAL} />
        <MiniMetric label="ethics blocks" value={counts.activity_24h.ethics_blocks}     delta="+1"  data={MOCK_DATA.SPARK_BLOCKS} />
        <MiniMetric label="ethics flags"  value={counts.activity_24h.ethics_flags}      delta="0"   data={MOCK_DATA.SPARK_FLAGS} />
      </div>

      {/* Counts row */}
      <div className="cc-grid cols-2" style={{ marginBottom: 18 }}>
        <SectionCard title="Corpus" count="total">
          <KV k="Skills"        v={counts.skills.toLocaleString()} />
          <KV k="Memories"      v={counts.memories.toLocaleString()} />
          <KV k="Journal"       v={counts.journal_entries.toLocaleString()} />
          <KV k="Ethics events" v={counts.ethics_events.toLocaleString()} />
        </SectionCard>
        <SectionCard title="Activity · last 24h" count="live">
          <KV k="Memories captured" v={counts.activity_24h.memories_captured} />
          <KV k="Journal entries"   v={counts.activity_24h.journal_entries} />
          <KV k="Ethics blocks"     v={counts.activity_24h.ethics_blocks} />
          <KV k="Ethics flags"      v={counts.activity_24h.ethics_flags} />
        </SectionCard>
      </div>

      {/* Plugin + recent activity */}
      <div className="cc-grid cols-2" style={{ marginBottom: 18 }}>
        <SectionCard title="Plugin" count={`v${health.version}`} padded>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 10, fontSize: 13 }}>
            <div style={{ color: "var(--c-fg-muted)" }}>Version</div>
            <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>{health.version}</div>
            <div style={{ color: "var(--c-fg-muted)" }}>Edition</div>
            <div style={{ color: "var(--c-fg)" }}>Hard · Postgres + Qdrant + Valkey + TEI</div>
            <div style={{ color: "var(--c-fg-muted)" }}>Seed</div>
            <div style={{ color: "var(--c-fg)" }}>{health.seed.version} · Apache-2.0 · {fmtCount(health.seed.row_count)} modules</div>
            <div style={{ color: "var(--c-fg-muted)" }}>Installed</div>
            <div style={{ color: "var(--c-fg)" }}>{fmtRelative(health.installed_at)}</div>
          </div>

          <div style={{
            marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--c-divider)",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <button className={`celiums-btn ${updateState === "available" ? "primary" : ""}`} onClick={checkUpdate} disabled={updateState === "checking"}>
              {updateState === "checking" && <>↻ Checking…</>}
              {updateState === "idle"     && <>◯ Check for updates</>}
              {updateState === "uptodate" && <>↻ Check again</>}
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

        <SectionCard title="Recent activity" count={MOCK_DATA.RECENT_ACTIVITY.length}
          action={<button className="celiums-btn ghost sm">View all →</button>}>
          {MOCK_DATA.RECENT_ACTIVITY.slice(0, 8).map((e, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "52px 22px 1fr",
              alignItems: "center", gap: 10,
              padding: "8px 18px", borderBottom: i < 7 ? "1px solid var(--c-divider)" : "none",
              fontSize: 12.5,
            }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg-subtle)" }}>{e.ts}</span>
              <ActivityIcon type={e.type} />
              <span style={{ color: "var(--c-fg-muted)" }}>{e.text}</span>
            </div>
          ))}
        </SectionCard>
      </div>

      {/* Pillar distribution */}
      <SectionCard title={`Skill corpus by pillar`} count={`${MOCK_DATA.PILLARS.length} pillars · ${fmtCount(MOCK_DATA.PILLARS.reduce((a, p) => a + p.count, 0))}`}>
        <div style={{ padding: "14px 18px" }}>
          {MOCK_DATA.PILLARS.map(p => (
            <div className="cc-pillar-row" key={p.name}>
              <div className="name">
                <span style={{ width: 14, color: "var(--c-fg-muted)", textAlign: "center" }}>{MOCK_DATA.PILLAR_ICONS[p.name]}</span>
                {p.name}
              </div>
              <div className="track"><i style={{ width: `${(p.count / 1000) * 100}%` }} /></div>
              <div className="num">{fmtCount(p.count)}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </>
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

export function MiniMetric({ label, value, delta, data }) {
  const positive = !delta.startsWith("-") && delta !== "0";
  return (
    <div className="celiums-card cc-metric">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {delta && <span className={`delta ${positive ? "" : "neg"}`}>{positive ? "↑" : delta === "0" ? "·" : "↓"} {delta}</span>}
      </div>
      <Sparkline data={data} />
    </div>
  );
}

export function ActivityIcon({ type }) {
  const map = {
    memory:  { c: "var(--c-green)",     bg: "var(--c-green-soft)",  ch: "◉" },
    journal: { c: "#5a7fa3",            bg: "rgba(90,127,163,0.15)", ch: "≡" },
    ethics:  { c: "var(--c-amber-text)", bg: "var(--c-amber-soft)",  ch: "⚖" },
    block:   { c: "var(--c-red-text)",   bg: "var(--c-red-soft)",    ch: "⊘" },
  };
  const v = map[type] || map.memory;
  return (
    <span style={{
      width: 22, height: 22, borderRadius: 4, display: "grid", placeItems: "center",
      background: v.bg, color: v.c, fontSize: 11,
    }}>{v.ch}</span>
  );
}

Object.assign(window, { Overview });
