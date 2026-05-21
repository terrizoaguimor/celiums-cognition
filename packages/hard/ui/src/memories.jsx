/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState, useEffect } from "react";
import { fetchMemories, useQuery } from "./data.js";
import { Ico } from "./celiums-primitives.jsx";
import { Drawer, PageHead, HelpPopover, Paginator, fmtCount, fmtRelative } from "./cc-shell.jsx";

/* Memories tab — VAD-tagged persistent memories from the cognitive store.
 *
 * Backend returns the PG `memories` schema directly:
 *   id, user_id, project_id, session_id, content, summary,
 *   memory_type, scope, importance, emotional_valence,
 *   emotional_arousal, emotional_dominance, confidence, strength,
 *   retrieval_count, last_retrieved_at, state, tags,
 *   created_at, updated_at
 * Valence is signed (-1..1); arousal/dominance are 0..1 (engine convention).
 */

const PAGE_SIZE = 30;
const DEBOUNCE_MS = 280;

export function Memories({ showToast }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [valence, setValence] = useState("any");    // any | positive | neutral | negative
  const [bucket, setBucket] = useState("all");      // all | today | yesterday | week | month | year
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setOffset(0); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setOffset(0); }, [bucket]);

  const memoriesQ = useQuery(
    () => fetchMemories({
      q: debouncedQ.trim() || null,
      bucket: bucket !== "all" ? bucket : null,
      limit: PAGE_SIZE,
      offset,
    }),
    [debouncedQ, bucket, offset],
  );

  const all = memoriesQ.data?.memories ?? [];
  // Valence filter applied client-side to the current page (server doesn't
  // expose this as a filter param — keeps the API surface small).
  const memories = all.filter((m) => {
    if (valence === "any") return true;
    const v = Number(m.emotional_valence ?? 0);
    if (valence === "positive") return v >= 0.3;
    if (valence === "negative") return v <= -0.3;
    if (valence === "neutral")  return v > -0.3 && v < 0.3;
    return true;
  });
  const total = memoriesQ.data?.total ?? 0;

  return (
    <>
      <PageHead
        eyebrow="Persistent emotional memory · VAD-tagged"
        title="Memories"
        sub={<>{fmtCount(total)} captured · embedding via TEI · stored in <code style={{fontFamily:"var(--font-mono)",color:"var(--c-fg)"}}>memories</code> + qdrant</>}
        actions={
          <>
            <span className="celiums-chip green">affect-tagged</span>
            <span className="celiums-chip">importance-scored</span>
            <HelpPopover title="VAD / PAD affect model">
              <p style={{ margin: "0 0 8px" }}>
                Every memory carries three affective axes drawn from the
                <em> Pleasure–Arousal–Dominance</em> (PAD, also called VAD)
                model — a continuous representation of emotional state
                used in affective computing since Mehrabian (1974).
              </p>
              <ul style={{ margin: "8px 0", paddingLeft: 18, lineHeight: 1.5 }}>
                <li><strong>Valence</strong> (−1…+1): pleasant ↔ unpleasant.
                  Captured as <code>emotional_valence</code>.</li>
                <li><strong>Arousal</strong> (0…1): calm ↔ activated. How
                  energized the moment felt.</li>
                <li><strong>Dominance</strong> (0…1): submissive ↔ in
                  control. Whether the agent felt steered or steering.</li>
              </ul>
              <p style={{ margin: "8px 0 0", color: "var(--c-fg-muted)" }}>
                These values flow into recall: the engine retrieves
                memories with affect similar to the current conversational
                state, not just topically similar ones. This is what makes
                Cognition <em>persistent emotional</em> memory rather than
                plain semantic search.
              </p>
            </HelpPopover>
          </>
        }
      />

      <div className="cc-search-row">
        <div className="cc-search-input">
          <span className="icon"><Ico.search width={15} height={15} /></span>
          <input
            type="text"
            placeholder="Search memory text…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {memoriesQ.loading && <div className="spin" />}
        </div>
        <select value={valence} onChange={(e) => setValence(e.target.value)}
          className="celiums-input" style={{ width: "auto", padding: "8px 10px", fontSize: 13 }}>
          <option value="any">Any valence</option>
          <option value="positive">Positive (≥ +0.3)</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative (≤ −0.3)</option>
        </select>
        <select value={bucket} onChange={(e) => setBucket(e.target.value)}
          className="celiums-input" style={{ width: "auto", padding: "8px 10px", fontSize: 13 }}>
          <option value="all">Any time</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="year">Last 365 days</option>
        </select>
      </div>

      <div className="cc-results-head">
        <div className="left">
          <span className="count">{memories.length}</span>
          <span>of {fmtCount(total)} memories</span>
        </div>
        <div className="cc-sort">
          <span style={{ fontSize: 11, color: "var(--c-fg-subtle)" }}>Sort</span>
          <select disabled>
            <option>Most recent</option>
          </select>
        </div>
      </div>

      {memoriesQ.error && (
        <div style={{ padding: "24px 18px", color: "var(--c-red-text)", fontSize: 13 }}>
          {memoriesQ.error.message}
        </div>
      )}
      {!memoriesQ.loading && memories.length === 0 && (
        <div className="cc-empty">
          <div className="glyph"><Ico.search width={22} height={22} /></div>
          <h3>No memories match.</h3>
          <p>Have a conversation with an agent on this gateway to capture some.</p>
        </div>
      )}

      {memories.map((m) => (
        <MemoryRow key={m.id} m={m} selected={selected?.id === m.id}
          onClick={() => setSelected(m)} />
      ))}

      <Paginator
        offset={offset}
        pageSize={PAGE_SIZE}
        count={all.length}
        total={total}
        loading={memoriesQ.loading}
        onChange={setOffset}
      />

      <MemoryDrawer m={selected} onClose={() => setSelected(null)} showToast={showToast} />
    </>
  );
}

export function MemoryRow({ m, selected, onClick }) {
  const valence = Number(m.emotional_valence ?? 0);
  const arousal = Number(m.emotional_arousal ?? 0);
  const dominance = Number(m.emotional_dominance ?? 0);
  const importance = Number(m.importance ?? 0);
  const text = m.content ?? m.summary ?? "";
  return (
    <div className={`cc-result ${selected ? "selected" : ""}`} onClick={onClick}
      style={{ gridTemplateColumns: "36px 1fr 220px" }}>
      <div className="pill-ico" style={{ color: "var(--c-green)" }}>◉</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: "var(--c-fg)", lineHeight: 1.55 }}>
          {text.length > 280 ? text.slice(0, 280) + "…" : text}
        </div>
        <div className="meta" style={{ marginTop: 10 }}>
          <span style={{ fontSize: 11.5, color: "var(--c-fg-subtle)" }}
                title={fmtAbsoluteLocal(m.created_at)}>
            {fmtRelative(m.created_at)} · {fmtDateShort(m.created_at)}
          </span>
          <span style={{ color: "var(--c-fg-faint)" }}>·</span>
          {m.memory_type && <span className="celiums-chip">{m.memory_type}</span>}
          {m.scope && <span className="celiums-chip">{m.scope}</span>}
          <span className="celiums-chip green">importance {(importance * 100).toFixed(0)}</span>
          {(m.tags ?? []).slice(0, 4).map((t) => <span key={t} className="cc-tag">{t}</span>)}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <Axis ax="valence"   v={valence} signed />
        <Axis ax="arousal"   v={arousal} />
        <Axis ax="dominance" v={dominance} />
      </div>
    </div>
  );
}

/* Date helpers — show the user the WEEKDAY + DAY + TIME so they can ask
 * "what happened on day X" and visually scan back. Falls back to
 * relative time for the past-hour bucket where absolute dates clutter
 * without helping. */
export function fmtDateShort(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  } catch { return "—"; }
}

export function fmtAbsoluteLocal(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch { return "—"; }
}

/* VAD axis bar.
 *   signed=true:  v ∈ [-1, 1], rendered from a center anchor.
 *   signed=false: v ∈ [0, 1],  rendered from the left edge. */
export function Axis({ ax, v, signed = false }) {
  const clamped = Math.max(-1, Math.min(1, Number(v) || 0));
  const left = signed
    ? `${50 + Math.min(0, clamped) * 50}%`
    : "0%";
  const width = signed
    ? `${Math.abs(clamped) * 50}%`
    : `${Math.max(0, clamped) * 100}%`;
  return (
    <div className="cc-affect">
      <span className="ax">{ax}</span>
      <span className="track"><i style={{ left, width }} /></span>
      <span className="val">{clamped.toFixed(2)}</span>
    </div>
  );
}

export function MemoryDrawer({ m, onClose, showToast }) {
  if (!m) return <Drawer open={false} onClose={onClose} />;
  const valence = Number(m.emotional_valence ?? 0);
  const arousal = Number(m.emotional_arousal ?? 0);
  const dominance = Number(m.emotional_dominance ?? 0);
  const importance = Number(m.importance ?? 0);
  return (
    <Drawer open={true} onClose={onClose}>
      <div className="cc-drawer-head">
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: "var(--c-surface-2)", border: "1px solid var(--c-divider)",
          display: "grid", placeItems: "center", color: "var(--c-green)", fontSize: 20,
        }}>
          ◉
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Memory · {String(m.id).slice(0, 8)}…</h2>
          <div className="slug">
            {fmtAbsoluteLocal(m.created_at)} · {fmtRelative(m.created_at)}
            {" · "}{m.memory_type ?? "—"} · {m.scope ?? "—"}
          </div>
        </div>
        <button className="cc-icon-btn" onClick={onClose}><Ico.x width={14} height={14} /></button>
      </div>

      <div className="cc-drawer-meta">
        {m.memory_type && <span className="celiums-chip">{m.memory_type}</span>}
        {m.scope       && <span className="celiums-chip">{m.scope}</span>}
        {m.state       && <span className="celiums-chip">{m.state}</span>}
        <span className="celiums-chip">valence {valence.toFixed(2)}</span>
        <span className="celiums-chip">arousal {arousal.toFixed(2)}</span>
        <span className="celiums-chip">dominance {dominance.toFixed(2)}</span>
        <span className="celiums-chip green">importance {(importance * 100).toFixed(0)}</span>
        {m.retrieval_count != null && <span className="celiums-chip">recalled {m.retrieval_count}×</span>}
      </div>

      <div className="cc-drawer-body">
        {m.summary && (
          <>
            <h3>Summary</h3>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--c-fg)" }}>{m.summary}</p>
          </>
        )}

        <h3>Captured content</h3>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--c-fg)", whiteSpace: "pre-wrap" }}>{m.content}</p>

        <h3>Affect (VAD model)</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
          <Axis ax="valence" v={valence} signed />
          <Axis ax="arousal" v={arousal} />
          <Axis ax="dominance" v={dominance} />
        </div>

        <h3>Storage</h3>
        <table className="celiums-table" style={{ border: "1px solid var(--c-border)", borderRadius: 8, overflow: "hidden" }}>
          <tbody>
            {[
              ["id", m.id],
              ["user_id", m.user_id],
              ["project_id", m.project_id ?? "—"],
              ["session_id", m.session_id ?? "—"],
              ["memory_type", m.memory_type ?? "—"],
              ["scope", m.scope ?? "—"],
              ["state", m.state ?? "—"],
              ["importance", importance.toFixed(2)],
              ["confidence", Number(m.confidence ?? 0).toFixed(2)],
              ["strength", Number(m.strength ?? 0).toFixed(2)],
              ["created_at", m.created_at],
              ["updated_at", m.updated_at],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ width: 160, color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{k}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {(m.tags ?? []).length > 0 && (
          <>
            <h3>Tags</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {m.tags.map((t) => <span key={t} className="cc-tag">{t}</span>)}
            </div>
          </>
        )}
      </div>

      <div className="cc-drawer-foot">
        <button className="celiums-btn primary" onClick={() => { navigator.clipboard?.writeText(m.content ?? ""); showToast("Memory copied"); }}>
          <Ico.copy width={13} height={13} /> Copy text
        </button>
        <button className="celiums-btn ghost" style={{ marginLeft: "auto" }} onClick={onClose}>Close</button>
      </div>
    </Drawer>
  );
}
