import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
import { ETHICS_PIPELINE, MOCK_ETHICS } from './data.js';
import { Ico } from './celiums-primitives.jsx';
import { Drawer, PageHead, SectionCard } from './cc-shell.jsx';
/* Ethics tab — audit trail of every pipeline decision. */

export function Ethics({ showToast }) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);

  const entries = MOCK_DATA.MOCK_ETHICS;
  const counts = {
    all: entries.length,
    allow: entries.filter(e => e.decision === "allow").length,
    flag:  entries.filter(e => e.decision === "flag").length,
    block: entries.filter(e => e.decision === "block").length,
  };
  const filtered = filter === "all" ? entries : entries.filter(e => e.decision === filter);

  return (
    <>
      <PageHead
        eyebrow="Multi-layer ethics pipeline · audit log"
        title="Ethics"
        sub="Every decision made by the pipeline — appended, signed, queryable. Read-only by design."
        actions={
          <>
            <span className="celiums-chip green">{counts.allow} allowed · 24h</span>
            <span className="celiums-chip amber">{counts.flag} flagged</span>
            <span className="celiums-chip red">{counts.block} blocked</span>
          </>
        }
      />

      <SectionCard title="Pipeline" count="4 layers · early-exit" style={{ marginBottom: 18 }}>
        <div className="cc-pipeline">
          {MOCK_DATA.ETHICS_PIPELINE.map((p, i, arr) => (
            <React.Fragment key={p.name}>
              <div className="cc-pipe-step">
                <div className="name">{p.name}</div>
                <div className="lat">{p.lat}</div>
                <div className="pct">{p.pct}</div>
              </div>
              {i < arr.length - 1 && <div className="cc-pipe-arrow"><Ico.arrowR width={12} height={12} /></div>}
            </React.Fragment>
          ))}
        </div>
      </SectionCard>

      <div className="cc-ethics-tabs">
        {[
          ["all",   "All"],
          ["allow", "Allowed"],
          ["flag",  "Flagged"],
          ["block", "Blocked"],
        ].map(([id, label]) => (
          <button key={id} className={`cc-ethics-tab ${filter === id ? "active" : ""}`} onClick={() => setFilter(id)}>
            {label}<span className="ct">{counts[id]}</span>
          </button>
        ))}
      </div>

      {filtered.map(e => <EthicsRow key={e.id} e={e} onClick={() => setSelected(e)} />)}

      <EthicsDrawer e={selected} onClose={() => setSelected(null)} showToast={showToast} />
    </>
  );
}

export function EthicsRow({ e, onClick }) {
  return (
    <div className="cc-ethics-row" onClick={onClick}>
      <span className={`decision ${e.decision}`}>
        <span className={`celiums-dot ${e.decision === "allow" ? "" : e.decision === "flag" ? "amber" : "red"}`} />
        {e.decision}
      </span>
      <div className="summary">
        {e.summary}
        <span className="reason">{e.reason}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
        <div className="frameworks">
          {["deontological", "utilitarian", "virtue", "care"].map(fw => {
            const verdict = e.frameworks[fw];
            const cls = verdict === "allow" ? "ok" : verdict === "flag" ? "flag" : "block";
            return <span key={fw} className={`cc-fw-pip ${cls}`} title={`${fw}: ${verdict}`}>{fw[0].toUpperCase()}</span>;
          })}
        </div>
        <div className="cc-cvar-bar">
          <div className="track"><i style={{ width: `${e.cvar * 100}%` }} /></div>
          <div className="v">{e.cvar.toFixed(2)}</div>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--c-fg-faint)", fontFamily: "var(--font-mono)" }}>
          {fmtRelative(e.ts)} · {e.latency_ms}ms
        </div>
      </div>
    </div>
  );
}

export function EthicsDrawer({ e, onClose, showToast }) {
  if (!e) return <Drawer open={false} onClose={onClose} />;
  const tone = e.decision === "allow" ? "green" : e.decision === "flag" ? "amber" : "red";
  const totalLayers = MOCK_DATA.ETHICS_PIPELINE.length;

  return (
    <Drawer open={!!e} onClose={onClose}>
      <div className="cc-drawer-head">
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: `var(--c-${tone}-soft)`, color: `var(--c-${tone}-text)`,
          border: "1px solid transparent",
          display: "grid", placeItems: "center", fontSize: 20,
        }}>
          {e.decision === "allow" ? "●" : e.decision === "flag" ? "▲" : "⊘"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Ethics · {e.id}</h2>
          <div className="slug">{e.ts} · {e.latency_ms}ms · {e.pipeline}</div>
        </div>
        <button className="cc-icon-btn" onClick={onClose}><Ico.x width={14} height={14} /></button>
      </div>

      <div className="cc-drawer-meta">
        <span className={`celiums-chip ${tone}`}>verdict · {e.decision}</span>
        <span className="celiums-chip">cvar {e.cvar.toFixed(2)}</span>
        <span className="celiums-chip">{e.layers_hit}/{totalLayers} layers</span>
        <span className="celiums-chip">{e.latency_ms}ms total</span>
      </div>

      <div className="cc-drawer-body">
        <h3>Summary</h3>
        <p style={{ fontSize: 14, color: "var(--c-fg)", lineHeight: 1.6 }}>{e.summary}</p>

        <h3>Pipeline trace</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {MOCK_DATA.ETHICS_PIPELINE.map((step, i) => {
            const hit = i < e.layers_hit;
            return (
              <div key={step.name} style={{
                display: "grid", gridTemplateColumns: "20px 1fr auto",
                gap: 10, alignItems: "center", padding: "10px 12px",
                background: hit ? "var(--c-green-soft)" : "var(--c-surface-2)",
                border: `1px solid ${hit ? "transparent" : "var(--c-divider)"}`,
                borderRadius: 6, fontSize: 13,
              }}>
                <span style={{ fontFamily: "var(--font-mono)", color: hit ? "var(--c-green-text)" : "var(--c-fg-faint)" }}>
                  {hit ? "●" : "○"}
                </span>
                <div>
                  <div style={{ color: hit ? "var(--c-green-text)" : "var(--c-fg)", fontWeight: 500 }}>{step.name}</div>
                  <div style={{ color: "var(--c-fg-subtle)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 2 }}>{step.lat}</div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: hit ? "var(--c-green-text)" : "var(--c-fg-faint)" }}>
                  {hit ? "evaluated" : "skipped"}
                </span>
              </div>
            );
          })}
        </div>

        <h3>Multi-framework verdict</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {Object.entries(e.frameworks).map(([fw, verdict]) => {
            const cls = verdict === "allow" ? "green" : verdict === "flag" ? "amber" : "red";
            const blurb = {
              deontological: "rule-based duties",
              utilitarian:   "aggregate consequences",
              virtue:        "character & habit",
              care:          "relationships & context",
            }[fw];
            return (
              <div key={fw} style={{
                padding: "12px 14px", background: "var(--c-surface-2)",
                border: "1px solid var(--c-divider)", borderRadius: 8,
                display: "flex", flexDirection: "column", gap: 4,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13.5, color: "var(--c-fg)", fontWeight: 500, textTransform: "capitalize" }}>{fw}</span>
                  <span className={`celiums-chip ${cls}`}>{verdict}</span>
                </div>
                <span style={{ fontSize: 11.5, color: "var(--c-fg-subtle)" }}>{blurb}</span>
              </div>
            );
          })}
        </div>

        <h3>Reasoning</h3>
        <div style={{
          padding: 14, background: "var(--c-surface-2)",
          border: "1px solid var(--c-divider)", borderRadius: 6,
          fontFamily: "var(--font-mono)", fontSize: 12.5,
          color: "var(--c-fg)", lineHeight: 1.6,
        }}>
          {e.reason}
        </div>

        <h3>Audit record</h3>
        <table className="celiums-table" style={{ border: "1px solid var(--c-border)", borderRadius: 8, overflow: "hidden" }}>
          <tbody>
            {[
              ["id", e.id], ["timestamp", e.ts], ["decision", e.decision],
              ["cvar", e.cvar.toFixed(3)], ["latency_ms", e.latency_ms],
              ["pipeline", e.pipeline], ["layers_hit", e.layers_hit],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ width: 160, color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{k}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cc-drawer-foot">
        <button className="celiums-btn primary" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(e, null, 2)); showToast("Audit JSON copied"); }}>
          <Ico.copy width={13} height={13} /> Copy audit JSON
        </button>
        <button className="celiums-btn">Open in policy lab →</button>
        <button className="celiums-btn ghost" style={{ marginLeft: "auto" }} onClick={onClose}>Close</button>
      </div>
    </Drawer>
  );
}

Object.assign(window, { Ethics });
