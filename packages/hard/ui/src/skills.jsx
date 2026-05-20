import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
import { MOCK_SKILLS, PILLARS, PILLAR_ICONS, SAMPLE_CONTENT } from './data.js';
import { Ico } from './celiums-primitives.jsx';
import { Drawer, MarkdownView, PageHead } from './cc-shell.jsx';
/* Skills tab — corpus browse + semantic search. */

export function Skills({ showToast }) {
  const allPillars = MOCK_DATA.PILLARS.map(p => p.name);
  const [q, setQ] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [pillars, setPillars] = useState(new Set(allPillars));
  const [minEval, setMinEval] = useState(0.0);
  const [groundedOnly, setGroundedOnly] = useState(false);
  const [debouncing, setDebouncing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState("relevance");
  const searchRef = useRef(null);

  useEffect(() => {
    if (q.length === 0) return;
    setDebouncing(true);
    const t = setTimeout(() => setDebouncing(false), 350);
    return () => clearTimeout(t);
  }, [q, semantic]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    let r = MOCK_DATA.MOCK_SKILLS.filter(s => pillars.has(s.pillar));
    if (groundedOnly) r = r.filter(s => s.grounded);
    if (minEval > 0) r = r.filter(s => s.eval_score >= minEval);
    if (q.trim()) {
      const needle = q.toLowerCase();
      r = r.filter(s =>
        s.display_name.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle) ||
        s.keywords.some(k => k.toLowerCase().includes(needle)) ||
        s.pillar.includes(needle) ||
        s.category.includes(needle)
      );
    }
    if (sort === "eval")        r = [...r].sort((a, b) => b.eval_score - a.eval_score);
    else if (sort === "lines")  r = [...r].sort((a, b) => b.line_count - a.line_count);
    else if (sort === "alpha")  r = [...r].sort((a, b) => a.display_name.localeCompare(b.display_name));
    else if (semantic)          r = [...r].sort((a, b) => b.similarity - a.similarity);
    return r;
  }, [q, pillars, minEval, groundedOnly, sort, semantic]);

  const totalCount = filtered.length === MOCK_DATA.MOCK_SKILLS.length && !q.trim()
    ? 10000
    : Math.floor(filtered.length * (q.trim() ? 1 : 416));

  const togglePillar = name => {
    setPillars(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const resetFilters = () => {
    setPillars(new Set(allPillars));
    setMinEval(0.0); setGroundedOnly(false); setQ("");
  };

  return (
    <>
      <PageHead
        eyebrow={`Skills · ${semantic ? "semantic (HNSW)" : "text (FTS)"} search`}
        title="Skills"
        sub={<>10,000-module seed corpus · embedding model <code style={{fontFamily:"var(--font-mono)",color:"var(--c-fg)"}}>gte-large-en-v1.5</code> · re-rank with similarity threshold</>}
        actions={
          <>
            <span className="celiums-chip">10 pillars</span>
            <span className="celiums-chip green">9,847 eval ≥ 8.0</span>
          </>
        }
      />

      <div className="cc-search-row">
        <div className="cc-search-input">
          <span className="icon"><Ico.search width={15} height={15} /></span>
          <input
            ref={searchRef}
            type="text"
            placeholder={semantic ? "Describe what you're looking for…" : "Search skills…"}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {debouncing && <div className="spin" />}
          {!debouncing && q.length === 0 && <span className="kbd-tip">/</span>}
        </div>
        <div className={`cc-semantic ${semantic ? "on" : ""}`} onClick={() => setSemantic(s => !s)}>
          <span>Semantic</span>
          <span className="sw" />
        </div>
        <button className="celiums-btn" onClick={() => {
          const url = `/api/celiums-cognition/skills?q=${encodeURIComponent(q)}&semantic=${semantic}`;
          navigator.clipboard?.writeText(url);
          showToast("API URL copied");
        }}>
          <Ico.copy width={13} height={13} /> API
        </button>
      </div>

      <div className="cc-skills-layout">
        {/* Filters */}
        <aside className="cc-filters">
          <div className="group">
            <h4>Pillar</h4>
            {MOCK_DATA.PILLARS.map(p => (
              <div
                key={p.name}
                className={`cc-filter-opt ${pillars.has(p.name) ? "active" : ""}`}
                onClick={() => togglePillar(p.name)}
              >
                <span className="cc-checkbox" />
                <span className="lbl">
                  <span style={{ color: p.color, opacity: 0.9, width: 12, textAlign: "center" }}>
                    {MOCK_DATA.PILLAR_ICONS[p.name]}
                  </span>
                  {p.name}
                </span>
                <span className="ct">{fmtCount(p.count)}</span>
              </div>
            ))}
          </div>

          <div className="group">
            <h4>Quality</h4>
            <div style={{ fontSize: 11, color: "var(--c-fg-subtle)", marginBottom: 4 }}>Min eval score</div>
            <div className="cc-range-row">
              <input type="range" min="0" max="10" step="0.5" value={minEval}
                onChange={e => setMinEval(parseFloat(e.target.value))} />
              <span className="val">{minEval.toFixed(1)}</span>
            </div>
            <div
              className={`cc-filter-opt ${groundedOnly ? "active" : ""}`}
              onClick={() => setGroundedOnly(g => !g)}
              style={{ marginTop: 10 }}
            >
              <span className="cc-checkbox" />
              <span className="lbl">Grounded only</span>
              <span className="ct">6.2k</span>
            </div>
          </div>

          <div className="group">
            <h4>Category</h4>
            <select className="celiums-input" style={{ padding: "7px 10px", fontSize: 12.5 }}>
              <option>Any category</option>
              <option>databases</option>
              <option>vector-databases</option>
              <option>deep-learning</option>
              <option>cryptography</option>
            </select>
          </div>

          <div className="group" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <a className="celiums-link" onClick={resetFilters} style={{ fontSize: 12 }}>↻ Reset filters</a>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--c-fg-subtle)" }}>
              {pillars.size}/{allPillars.length} pillars
            </span>
          </div>
        </aside>

        {/* Results */}
        <div>
          <div className="cc-results-head">
            <div className="left">
              <span className="count">
                {filtered.length === 0
                  ? "0"
                  : filtered.length === MOCK_DATA.MOCK_SKILLS.length
                    ? "10,000"
                    : `${filtered.length} of ${fmtCount(totalCount)}`}
              </span>
              <span>results</span>
              {semantic && q.trim() && <span className="celiums-chip green">cosine · gte-large</span>}
              {!semantic && q.trim() && <span className="celiums-chip">FTS · tsvector</span>}
            </div>
            <div className="cc-sort">
              <span style={{ fontSize: 11, color: "var(--c-fg-subtle)" }}>Sort</span>
              <select value={sort} onChange={e => setSort(e.target.value)}>
                <option value="relevance">{semantic ? "Similarity" : "Relevance"}</option>
                <option value="eval">Eval score</option>
                <option value="lines">Line count</option>
                <option value="alpha">Alphabetical</option>
              </select>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyResults onReset={resetFilters} />
          ) : (
            <>
              {filtered.map(s => (
                <SkillRow key={s.name} skill={s} selected={selected?.name === s.name}
                  semantic={semantic && q.trim().length > 0} onClick={() => setSelected(s)} />
              ))}
              <div style={{ textAlign: "center", color: "var(--c-fg-faint)", fontSize: 12, padding: "16px 0 8px", fontFamily: "var(--font-mono)" }}>
                showing {filtered.length} · scroll to load more
              </div>
            </>
          )}
        </div>
      </div>

      <SkillDrawer skill={selected} onClose={() => setSelected(null)} showToast={showToast} />
    </>
  );
}

export function SkillRow({ skill, selected, semantic, onClick }) {
  const pillarColor = MOCK_DATA.PILLARS.find(p => p.name === skill.pillar)?.color || "var(--c-green)";
  return (
    <div className={`cc-result ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="pill-ico" style={{ color: pillarColor }}>
        {MOCK_DATA.PILLAR_ICONS[skill.pillar]}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="title">{skill.display_name}</div>
        <div className="desc">{skill.description}</div>
        <div className="meta">
          <span className="path"><span style={{ color: pillarColor }}>{skill.pillar}</span> · {skill.category}</span>
          <span className={`celiums-chip ${skill.eval_score >= 9.5 ? "green" : ""}`}>
            eval {skill.eval_score.toFixed(1)}
          </span>
          <span className="celiums-chip">{skill.line_count} lines</span>
          {skill.grounded && <span className="celiums-chip green">grounded</span>}
          {skill.keywords.slice(0, 4).map(k => <span key={k} className="cc-tag">{k}</span>)}
        </div>
      </div>
      <div className="right-col">
        {semantic ? (
          <>
            <div className="cc-sim-num">{skill.similarity.toFixed(2)}</div>
            <div className="cc-sim-bar"><i style={{ width: `${skill.similarity * 100}%` }} /></div>
            <div className="cc-sim-label">similarity</div>
          </>
        ) : (
          <div className="cc-sim-label" style={{ color: "var(--c-fg-subtle)" }}>open ↗</div>
        )}
      </div>
    </div>
  );
}

export function SkillDrawer({ skill, onClose, showToast }) {
  if (!skill) return <Drawer open={false} onClose={onClose} />;
  const pillarColor = MOCK_DATA.PILLARS.find(p => p.name === skill.pillar)?.color || "var(--c-green)";
  const content = MOCK_DATA.SAMPLE_CONTENT
    .replaceAll("{title}", skill.display_name)
    .replaceAll("{pillar}", skill.pillar);

  return (
    <Drawer open={!!skill} onClose={onClose}>
      <div className="cc-drawer-head">
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: "var(--c-surface-2)", border: "1px solid var(--c-divider)",
          display: "grid", placeItems: "center", color: pillarColor, fontSize: 20,
          flexShrink: 0,
        }}>
          {MOCK_DATA.PILLAR_ICONS[skill.pillar]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{skill.display_name}</h2>
          <div className="slug" style={{ cursor: "pointer" }}
            onClick={() => { navigator.clipboard?.writeText(skill.name); showToast(`Copied "${skill.name}"`); }}>
            {skill.name}
          </div>
        </div>
        <button className="cc-icon-btn" onClick={onClose}>
          <Ico.x width={14} height={14} />
        </button>
      </div>

      <div className="cc-drawer-meta">
        <span className="celiums-chip green">{skill.pillar}</span>
        <span className="celiums-chip">{skill.category}</span>
        <span className={`celiums-chip ${skill.eval_score >= 9.5 ? "green" : ""}`}>
          eval {skill.eval_score.toFixed(1)} · {skill.eval_verdict}
        </span>
        <span className="celiums-chip">{skill.line_count} lines</span>
        {skill.grounded ? <span className="celiums-chip green">grounded · 4 sources</span> : <span className="celiums-chip">ungrounded</span>}
        {skill.similarity != null && <span className="celiums-chip green">sim {skill.similarity.toFixed(2)}</span>}
      </div>

      <div className="cc-drawer-body">
        <h3>Description</h3>
        <p style={{ color: "var(--c-fg)", fontSize: 14, lineHeight: 1.6 }}>{skill.description}</p>

        <h3>Keywords</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {skill.keywords.map(k => <span key={k} className="cc-tag">{k}</span>)}
        </div>

        <h3>Metadata</h3>
        <table className="celiums-table" style={{ border: "1px solid var(--c-border)", borderRadius: 8, overflow: "hidden" }}>
          <tbody>
            {[
              ["name", skill.name],
              ["pillar", skill.pillar],
              ["category", skill.category],
              ["eval_score", skill.eval_score.toFixed(2)],
              ["eval_verdict", skill.eval_verdict],
              ["line_count", skill.line_count],
              ["grounded", String(skill.grounded)],
              ["embedding", "1024d · gte-large-en-v1.5"],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ width: 160, color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{k}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Content (markdown)</h3>
        <MarkdownView text={content} />
      </div>

      <div className="cc-drawer-foot">
        <button className="celiums-btn primary" onClick={() => {
          navigator.clipboard?.writeText(`You are an expert in ${skill.pillar}. Apply the following skill:\n\n${content}`);
          showToast("Copied as system prompt");
        }}>
          <Ico.copy width={13} height={13} /> Copy as system prompt
        </button>
        <button className="celiums-btn" onClick={() => {
          navigator.clipboard?.writeText(content);
          showToast("Markdown copied");
        }}>
          <Ico.copy width={13} height={13} /> Copy markdown
        </button>
        <button className="celiums-btn ghost" style={{ marginLeft: "auto" }} onClick={onClose}>Close</button>
      </div>
    </Drawer>
  );
}

export function EmptyResults({ onReset }) {
  return (
    <div className="cc-empty">
      <div className="glyph"><Ico.search width={22} height={22} /></div>
      <h3>No matching skills.</h3>
      <p>Try widening filters or switching to semantic search.</p>
      <button className="celiums-btn" onClick={onReset}>↻ Reset filters</button>
    </div>
  );
}

Object.assign(window, { Skills });
