import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
import { MOCK_COUNTS, MOCK_MEMORIES, PILLARS, PILLAR_ICONS } from './data.js';
import { Ico } from './celiums-primitives.jsx';
import { Drawer, PageHead } from './cc-shell.jsx';
/* Memories tab — emotional memory browser. */

export function Memories({ showToast }) {
  const [q, setQ] = useState("");
  const [semantic, setSemantic] = useState(true);
  const [pillarFilter, setPillarFilter] = useState("any");
  const [affectFilter, setAffectFilter] = useState("any");
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    let r = MOCK_DATA.MOCK_MEMORIES;
    if (pillarFilter !== "any") r = r.filter(m => m.pillar === pillarFilter);
    if (affectFilter === "positive") r = r.filter(m => m.affect.valence >= 0.6);
    if (affectFilter === "neutral")  r = r.filter(m => m.affect.valence >= 0.4 && m.affect.valence < 0.6);
    if (affectFilter === "negative") r = r.filter(m => m.affect.valence < 0.4);
    if (q.trim()) {
      const n = q.toLowerCase();
      r = r.filter(m =>
        m.text.toLowerCase().includes(n) ||
        m.pillar.includes(n) ||
        m.tag.includes(n)
      );
    }
    if (semantic) r = [...r].sort((a, b) => b.similarity - a.similarity);
    else          r = [...r].sort((a, b) => new Date(b.ts) - new Date(a.ts));
    return r;
  }, [q, semantic, pillarFilter, affectFilter]);

  return (
    <>
      <PageHead
        eyebrow="Persistent emotional memory · VAD-tagged"
        title="Memories"
        sub={<>{fmtCount(MOCK_DATA.MOCK_COUNTS.memories)} captured across {MOCK_DATA.PILLARS.length} pillars · last 24h: <strong style={{color:"var(--c-fg)"}}>{MOCK_DATA.MOCK_COUNTS.activity_24h.memories_captured}</strong> · embedding <code style={{fontFamily:"var(--font-mono)",color:"var(--c-fg)"}}>gte-large-en-v1.5</code></>}
        actions={
          <>
            <span className="celiums-chip green">affect-tagged</span>
            <span className="celiums-chip">salience-scored</span>
          </>
        }
      />

      <div className="cc-search-row">
        <div className="cc-search-input">
          <span className="icon"><Ico.search width={15} height={15} /></span>
          <input type="text"
            placeholder={semantic ? "What were we talking about?" : "Search memory text…"}
            value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className={`cc-semantic ${semantic ? "on" : ""}`} onClick={() => setSemantic(s => !s)}>
          <span>Semantic</span><span className="sw" />
        </div>
        <select value={pillarFilter} onChange={e => setPillarFilter(e.target.value)}
          className="celiums-input" style={{ width: "auto", padding: "8px 10px", fontSize: 13 }}>
          <option value="any">Any pillar</option>
          {MOCK_DATA.PILLARS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <select value={affectFilter} onChange={e => setAffectFilter(e.target.value)}
          className="celiums-input" style={{ width: "auto", padding: "8px 10px", fontSize: 13 }}>
          <option value="any">Any affect</option>
          <option value="positive">Positive valence</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative valence</option>
        </select>
      </div>

      <div className="cc-results-head">
        <div className="left">
          <span className="count">{filtered.length}</span>
          <span>of {fmtCount(MOCK_DATA.MOCK_COUNTS.memories)} memories</span>
          {semantic && q.trim() && <span className="celiums-chip green">cosine</span>}
        </div>
        <div className="cc-sort">
          <span style={{ fontSize: 11, color: "var(--c-fg-subtle)" }}>Sort</span>
          <select value={semantic ? "sim" : "time"} onChange={e => setSemantic(e.target.value === "sim")}>
            <option value="sim">Similarity</option>
            <option value="time">Most recent</option>
          </select>
        </div>
      </div>

      {filtered.map(m => (
        <MemoryRow key={m.id} m={m} selected={selected?.id === m.id}
          onClick={() => setSelected(m)}
          showSim={semantic && q.trim().length > 0} />
      ))}

      <MemoryDrawer m={selected} onClose={() => setSelected(null)} showToast={showToast} />
    </>
  );
}

export function MemoryRow({ m, selected, onClick, showSim }) {
  const pillarColor = MOCK_DATA.PILLARS.find(p => p.name === m.pillar)?.color || "var(--c-green)";
  return (
    <div className={`cc-result ${selected ? "selected" : ""}`} onClick={onClick}
      style={{ gridTemplateColumns: "36px 1fr 220px" }}>
      <div className="pill-ico" style={{ color: pillarColor }}>
        {MOCK_DATA.PILLAR_ICONS[m.pillar]}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: "var(--c-fg)", lineHeight: 1.55 }}>{m.text}</div>
        <div className="meta" style={{ marginTop: 10 }}>
          <span className="path" style={{ fontFamily: "var(--font-mono)", color: pillarColor }}>{m.pillar}</span>
          <span style={{ color: "var(--c-fg-faint)" }}>·</span>
          <span style={{ fontSize: 11.5, color: "var(--c-fg-subtle)" }}>{fmtRelative(m.ts)}</span>
          <span style={{ color: "var(--c-fg-faint)" }}>·</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--c-fg-subtle)" }}>via {m.source}</span>
          <span className="celiums-chip green">{m.tag}</span>
          <span className="celiums-chip">salience {Math.round(m.salience * 100)}</span>
          {showSim && <span className="celiums-chip green">sim {m.similarity.toFixed(2)}</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <Axis ax="valence"   v={m.affect.valence} />
        <Axis ax="arousal"   v={m.affect.arousal} />
        <Axis ax="dominance" v={m.affect.dominance} />
      </div>
    </div>
  );
}

export function Axis({ ax, v }) {
  return (
    <div className="cc-affect">
      <span className="ax">{ax}</span>
      <span className="track"><i style={{ width: `${v * 100}%`, left: 0 }} /></span>
      <span className="val">{v.toFixed(2)}</span>
    </div>
  );
}

export function MemoryDrawer({ m, onClose, showToast }) {
  if (!m) return <Drawer open={false} onClose={onClose} />;
  const pillarColor = MOCK_DATA.PILLARS.find(p => p.name === m.pillar)?.color || "var(--c-green)";
  return (
    <Drawer open={!!m} onClose={onClose}>
      <div className="cc-drawer-head">
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: "var(--c-surface-2)", border: "1px solid var(--c-divider)",
          display: "grid", placeItems: "center", color: pillarColor, fontSize: 20,
        }}>
          {MOCK_DATA.PILLAR_ICONS[m.pillar]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Memory · {m.id}</h2>
          <div className="slug">{m.pillar} · {fmtRelative(m.ts)} · via {m.source}</div>
        </div>
        <button className="cc-icon-btn" onClick={onClose}><Ico.x width={14} height={14} /></button>
      </div>

      <div className="cc-drawer-meta">
        <span className="celiums-chip green">{m.tag}</span>
        <span className="celiums-chip">valence {m.affect.valence.toFixed(2)}</span>
        <span className="celiums-chip">arousal {m.affect.arousal.toFixed(2)}</span>
        <span className="celiums-chip">dominance {m.affect.dominance.toFixed(2)}</span>
        <span className="celiums-chip green">salience {Math.round(m.salience * 100)}</span>
      </div>

      <div className="cc-drawer-body">
        <h3>Captured text</h3>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--c-fg)" }}>{m.text}</p>

        <h3>Affect (VAD model)</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
          <Axis ax="valence" v={m.affect.valence} />
          <Axis ax="arousal" v={m.affect.arousal} />
          <Axis ax="dominance" v={m.affect.dominance} />
        </div>

        <h3>Storage</h3>
        <table className="celiums-table" style={{ border: "1px solid var(--c-border)", borderRadius: 8, overflow: "hidden" }}>
          <tbody>
            {[
              ["id", m.id],
              ["pillar", m.pillar],
              ["agent", m.agent],
              ["channel", m.source],
              ["embedding", "1024d · gte-large-en-v1.5 · qdrant"],
              ["captured_at", m.ts],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ width: 160, color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{k}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Related memories</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {MOCK_DATA.MOCK_MEMORIES.filter(x => x.pillar === m.pillar && x.id !== m.id).slice(0, 3).map(rel => (
            <div key={rel.id} style={{
              padding: "10px 12px", background: "var(--c-surface-2)",
              border: "1px solid var(--c-divider)", borderRadius: 6,
              fontSize: 12.5, color: "var(--c-fg-muted)", cursor: "pointer",
            }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--c-green-text)" }}>{rel.id}</span> · {rel.text.slice(0, 100)}…
            </div>
          ))}
        </div>
      </div>

      <div className="cc-drawer-foot">
        <button className="celiums-btn primary" onClick={() => { navigator.clipboard?.writeText(m.text); showToast("Memory copied"); }}>
          <Ico.copy width={13} height={13} /> Copy text
        </button>
        <button className="celiums-btn">Find similar →</button>
        <button className="celiums-btn ghost" style={{ marginLeft: "auto" }} onClick={onClose}>Close</button>
      </div>
    </Drawer>
  );
}

Object.assign(window, { Memories });
