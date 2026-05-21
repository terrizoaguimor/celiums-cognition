/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  fetchSkills, fetchSkill, fetchPillars,
  pillarMeta, useQuery,
} from "./data.js";
import { Ico } from "./celiums-primitives.jsx";
import { Drawer, MarkdownView, PageHead, Paginator, fmtCount } from "./cc-shell.jsx";

/* Skills tab — corpus browse + hybrid (FTS + vector) search. */

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 280;

export function Skills({ showToast }) {
  // Query inputs
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [minEval, setMinEval] = useState(0.0);
  const [groundedOnly, setGroundedOnly] = useState(false);
  const [activePillars, setActivePillars] = useState(null); // null = all
  const [sort, setSort] = useState("relevance");
  const [offset, setOffset] = useState(0);
  const [selectedName, setSelectedName] = useState(null);
  const searchRef = useRef(null);

  // Pillars from backend
  const pillarsQ = useQuery(fetchPillars, []);
  const allPillars = pillarsQ.data?.pillars ?? [];

  // Initialize the active set after pillars load
  useEffect(() => {
    if (activePillars == null && allPillars.length > 0) {
      setActivePillars(new Set(allPillars.map((p) => p.name)));
    }
  }, [activePillars, allPillars]);

  // Debounce the search input → reset offset on change
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setOffset(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, semantic, minEval, groundedOnly, activePillars, sort]);

  // Focus search on '/'
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fetch skills with current filters
  const skillsQ = useQuery(() => {
    const params = {
      q: debouncedQ.trim() || null,
      semantic: semantic ? "true" : null,
      min_eval: minEval > 0 ? minEval : null,
      grounded: groundedOnly ? "true" : null,
      limit: PAGE_SIZE,
      offset,
    };
    if (activePillars && allPillars.length > 0
        && activePillars.size < allPillars.length) {
      params.pillar = Array.from(activePillars);
    }
    return fetchSkills(params);
  }, [debouncedQ, semantic, minEval, groundedOnly, activePillars, sort, offset, allPillars.length]);

  const skills = skillsQ.data?.skills ?? [];
  const total = skillsQ.data?.total ?? 0;

  // Client-side sort within the current page (server already ranks by FTS/vector)
  const sortedSkills = useMemo(() => {
    const arr = [...skills];
    if (sort === "eval")        arr.sort((a, b) => (b.eval_score ?? 0) - (a.eval_score ?? 0));
    else if (sort === "lines")  arr.sort((a, b) => (b.line_count ?? 0) - (a.line_count ?? 0));
    else if (sort === "alpha")  arr.sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""));
    else if (semantic && sort === "relevance")
      arr.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    return arr;
  }, [skills, sort, semantic]);

  const togglePillar = (name) => {
    setActivePillars((prev) => {
      const next = new Set(prev ?? allPillars.map((p) => p.name));
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };
  const resetFilters = () => {
    setActivePillars(new Set(allPillars.map((p) => p.name)));
    setMinEval(0.0);
    setGroundedOnly(false);
    setQ("");
  };

  const showingCount = sortedSkills.length;
  const corpusSize = allPillars.reduce((a, p) => a + p.count, 0);
  const evalAcceptCount = "—"; // requires another endpoint; show static placeholder

  return (
    <>
      <PageHead
        eyebrow={`Skills · ${semantic ? "semantic (HNSW)" : "hybrid (FTS + vector)"} search`}
        title="Skills"
        sub={<>{fmtCount(corpusSize || 0)}-module corpus · embeddings via TEI · re-rank with similarity threshold</>}
        actions={
          <>
            <span className="celiums-chip">{allPillars.length} pillars</span>
            {!skillsQ.loading && (
              <span className="celiums-chip green">{fmtCount(total)} results</span>
            )}
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
            onChange={(e) => setQ(e.target.value)}
          />
          {skillsQ.loading && <div className="spin" />}
          {!skillsQ.loading && q.length === 0 && <span className="kbd-tip">/</span>}
        </div>
        <div className={`cc-semantic ${semantic ? "on" : ""}`} onClick={() => setSemantic((s) => !s)}>
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
            {pillarsQ.loading && allPillars.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--c-fg-subtle)" }}>loading…</div>
            )}
            {allPillars.map((p) => {
              const meta = pillarMeta(p.name);
              const active = activePillars ? activePillars.has(p.name) : true;
              return (
                <div
                  key={p.name}
                  className={`cc-filter-opt ${active ? "active" : ""}`}
                  onClick={() => togglePillar(p.name)}
                >
                  <span className="cc-checkbox" />
                  <span className="lbl">
                    <span style={{ color: meta.color, opacity: 0.9, width: 12, textAlign: "center" }}>
                      {meta.icon}
                    </span>
                    {p.name}
                  </span>
                  <span className="ct">{fmtCount(p.count)}</span>
                </div>
              );
            })}
          </div>

          <div className="group">
            <h4>Quality</h4>
            <div style={{ fontSize: 11, color: "var(--c-fg-subtle)", marginBottom: 4 }}>Min eval score</div>
            <div className="cc-range-row">
              <input type="range" min="0" max="10" step="0.5" value={minEval}
                onChange={(e) => setMinEval(parseFloat(e.target.value))} />
              <span className="val">{minEval.toFixed(1)}</span>
            </div>
            <div
              className={`cc-filter-opt ${groundedOnly ? "active" : ""}`}
              onClick={() => setGroundedOnly((g) => !g)}
              style={{ marginTop: 10 }}
            >
              <span className="cc-checkbox" />
              <span className="lbl">Grounded only</span>
              <span className="ct">—</span>
            </div>
          </div>

          <div className="group" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <a className="celiums-link" onClick={resetFilters} style={{ fontSize: 12 }}>↻ Reset filters</a>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--c-fg-subtle)" }}>
              {activePillars?.size ?? allPillars.length}/{allPillars.length} pillars
            </span>
          </div>
        </aside>

        {/* Results */}
        <div>
          <div className="cc-results-head">
            <div className="left">
              <span className="count">{fmtCount(showingCount)}</span>
              <span>of {fmtCount(total)}</span>
              {semantic && debouncedQ && <span className="celiums-chip green">cosine · TEI</span>}
              {!semantic && debouncedQ && <span className="celiums-chip">FTS · tsvector</span>}
            </div>
            <div className="cc-sort">
              <span style={{ fontSize: 11, color: "var(--c-fg-subtle)" }}>Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="relevance">{semantic ? "Similarity" : "Relevance"}</option>
                <option value="eval">Eval score</option>
                <option value="lines">Line count</option>
                <option value="alpha">Alphabetical</option>
              </select>
            </div>
          </div>

          {skillsQ.error && (
            <div style={{ padding: "24px 18px", color: "var(--c-red-text)", fontSize: 13 }}>
              {skillsQ.error.message}
            </div>
          )}
          {!skillsQ.loading && sortedSkills.length === 0 ? (
            <EmptyResults onReset={resetFilters} />
          ) : (
            <>
              {sortedSkills.map((s) => (
                <SkillRow key={s.name} skill={s}
                          selected={selectedName === s.name}
                          semantic={semantic && !!debouncedQ.trim()}
                          onClick={() => setSelectedName(s.name)} />
              ))}
              <Paginator
                offset={offset}
                pageSize={PAGE_SIZE}
                count={sortedSkills.length}
                total={total}
                loading={skillsQ.loading}
                onChange={setOffset}
              />
            </>
          )}
        </div>
      </div>

      <SkillDrawer name={selectedName} onClose={() => setSelectedName(null)} showToast={showToast} />
    </>
  );
}

export function SkillRow({ skill, selected, semantic, onClick }) {
  const meta = pillarMeta(skill.pillar);
  const evalScore = Number(skill.eval_score ?? 0);
  return (
    <div className={`cc-result ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="pill-ico" style={{ color: meta.color }}>
        {meta.icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="title">{skill.display_name ?? skill.name}</div>
        <div className="desc">{skill.description ?? ""}</div>
        <div className="meta">
          <span className="path"><span style={{ color: meta.color }}>{skill.pillar ?? "—"}</span> · {skill.category ?? "—"}</span>
          {Number.isFinite(evalScore) && evalScore > 0 && (
            <span className={`celiums-chip ${evalScore >= 9.5 ? "green" : ""}`}>
              eval {evalScore.toFixed(1)}
            </span>
          )}
          {skill.line_count != null && <span className="celiums-chip">{skill.line_count} lines</span>}
          {skill.grounded && <span className="celiums-chip green">grounded</span>}
          {(skill.keywords ?? []).slice(0, 4).map((k) => <span key={k} className="cc-tag">{k}</span>)}
        </div>
      </div>
      <div className="right-col">
        {semantic && skill.similarity != null ? (
          <>
            <div className="cc-sim-num">{Number(skill.similarity).toFixed(2)}</div>
            <div className="cc-sim-bar"><i style={{ width: `${Math.max(0, Math.min(1, skill.similarity)) * 100}%` }} /></div>
            <div className="cc-sim-label">similarity</div>
          </>
        ) : (
          <div className="cc-sim-label" style={{ color: "var(--c-fg-subtle)" }}>open ↗</div>
        )}
      </div>
    </div>
  );
}

export function SkillDrawer({ name, onClose, showToast }) {
  const skillQ = useQuery(
    () => (name ? fetchSkill(name) : Promise.resolve(null)),
    [name],
  );
  const skill = skillQ.data?.skill;
  if (!name) return <Drawer open={false} onClose={onClose} />;

  if (skillQ.loading || !skill) {
    return (
      <Drawer open={true} onClose={onClose}>
        <div style={{ padding: 24, color: "var(--c-fg-muted)", fontSize: 13 }}>
          {skillQ.error ? skillQ.error.message : "Loading skill…"}
        </div>
      </Drawer>
    );
  }

  const meta = pillarMeta(skill.pillar);
  const content = String(skill.content ?? "").trim() || "_(no body content stored for this skill)_";

  return (
    <Drawer open={true} onClose={onClose}>
      <div className="cc-drawer-head">
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: "var(--c-surface-2)", border: "1px solid var(--c-divider)",
          display: "grid", placeItems: "center", color: meta.color, fontSize: 20,
          flexShrink: 0,
        }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{skill.display_name ?? skill.name}</h2>
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
        {skill.pillar && <span className="celiums-chip green">{skill.pillar}</span>}
        {skill.category && <span className="celiums-chip">{skill.category}</span>}
        {skill.eval_score != null && (
          <span className={`celiums-chip ${Number(skill.eval_score) >= 9.5 ? "green" : ""}`}>
            eval {Number(skill.eval_score).toFixed(1)} {skill.eval_verdict ? `· ${skill.eval_verdict}` : ""}
          </span>
        )}
        {skill.line_count != null && <span className="celiums-chip">{skill.line_count} lines</span>}
        {skill.grounded
          ? <span className="celiums-chip green">grounded{skill.source_count ? ` · ${skill.source_count} sources` : ""}</span>
          : <span className="celiums-chip">ungrounded</span>}
        {skill.provenance_status && <span className="celiums-chip">{skill.provenance_status}</span>}
      </div>

      <div className="cc-drawer-body">
        <h3>Description</h3>
        <p style={{ color: "var(--c-fg)", fontSize: 14, lineHeight: 1.6 }}>{skill.description}</p>

        {(skill.keywords ?? []).length > 0 && (
          <>
            <h3>Keywords</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {skill.keywords.map((k) => <span key={k} className="cc-tag">{k}</span>)}
            </div>
          </>
        )}

        <h3>Metadata</h3>
        <table className="celiums-table" style={{ border: "1px solid var(--c-border)", borderRadius: 8, overflow: "hidden" }}>
          <tbody>
            {[
              ["name", skill.name],
              ["pillar", skill.pillar ?? "—"],
              ["category", skill.category ?? "—"],
              ["subcat", skill.subcat ?? "—"],
              ["eval_score", skill.eval_score != null ? Number(skill.eval_score).toFixed(2) : "—"],
              ["eval_verdict", skill.eval_verdict ?? "—"],
              ["line_count", skill.line_count ?? "—"],
              ["grounded", String(skill.grounded ?? false)],
              ["source_count", skill.source_count ?? "—"],
              ["version", skill.version ?? "—"],
              ["agent_type", skill.agent_type ?? "—"],
              ["provenance_status", skill.provenance_status ?? "—"],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ width: 160, color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{k}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Content (markdown)</h3>
        <MarkdownView text={content} />
      </div>

      <div className="cc-drawer-foot">
        <button className="celiums-btn primary" onClick={() => {
          navigator.clipboard?.writeText(`You are an expert in ${skill.pillar ?? "this domain"}. Apply the following skill:\n\n${content}`);
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
