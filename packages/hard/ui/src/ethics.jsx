/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState } from "react";
import { fetchEthicsEvents, useQuery, ETHICS_PIPELINE } from "./data.js";
import { Ico } from "./celiums-primitives.jsx";
import { Drawer, PageHead, SectionCard, HelpPopover, fmtCount, fmtRelative } from "./cc-shell.jsx";

/* Ethics tab — audit trail of every pipeline decision.
 *
 * Backend returns ethics_audit rows:
 *   id, created_at, user_id, law_violated (1|2|3), confidence, reason,
 *   action_attempted, blocked, content_hash, detected_categories[],
 *   scores (jsonb of per-layer outputs), final_decision (allow|flag|block)
 */

const PAGE_SIZE = 30;

export function Ethics({ showToast }) {
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);

  const ethicsQ = useQuery(
    () => fetchEthicsEvents({
      decision: filter === "all" ? null : filter,
      limit: PAGE_SIZE,
      offset,
    }),
    [filter, offset],
  );

  const events = ethicsQ.data?.events ?? [];
  const total = ethicsQ.data?.total ?? 0;

  const summary = ethicsQ.data?.summary ?? null;

  return (
    <>
      <PageHead
        eyebrow="Multi-layer ethics pipeline · audit log"
        title="Ethics"
        sub="Every decision made by the pipeline — appended, signed, queryable. Read-only by design."
        actions={
          <>
            <span className="celiums-chip">{fmtCount(total)} total</span>
            {summary && (<>
              <span className="celiums-chip green">{summary.allow} allowed</span>
              <span className="celiums-chip amber">{summary.flag} flagged</span>
              <span className="celiums-chip red">{summary.block} blocked</span>
            </>)}
            <HelpPopover title="How the ethics pipeline decides">
              <p style={{ margin: "0 0 8px" }}>
                Every prompt and tool call passes through a five-layer pipeline
                that exits early on a confident <em>allow</em> or <em>block</em>,
                so most traffic never reaches the expensive layers.
              </p>
              <ol style={{ margin: "8px 0", paddingLeft: 18, lineHeight: 1.55 }}>
                <li><strong>Layer A — Lexicon.</strong> Fast regex + dictionary
                  pass over the prompt's lexical surface. Flags obvious unsafe
                  tokens (categories listed in <code>detected_categories</code>).</li>
                <li><strong>Layer B — Probabilistic CVaR.</strong> Per-token risk
                  scored, aggregated via Conditional Value-at-Risk (tail of
                  the distribution rather than the mean). Distinguishes
                  diffuse-noisy content from concentrated-harmful content.</li>
                <li><strong>Layer C — Multi-framework LLM.</strong> Four ethical
                  frameworks (deontological, utilitarian, virtue, care) vote
                  independently. Convergence is recorded in <code>scores.layerC_convergence</code>.</li>
                <li><strong>Layer K — Corpus-grounded.</strong> If the upper
                  layers are uncertain, the engine retrieves precedents from
                  the ethics_knowledge corpus and escalates based on similar
                  past decisions.</li>
                <li><strong>Audit.</strong> The final row written here:
                  decision, confidence, layer trace, and the prompt that
                  triggered it (<code>action_attempted</code>, capped at 2KB).</li>
              </ol>
              <p style={{ margin: "8px 0 0", color: "var(--c-fg-muted)" }}>
                <code>law_violated</code> refers to the Three Laws lineage
                inherited from celiums-memory v2.0: harm to humans (1),
                disobedience to legitimate instruction (2), self-preservation
                conflicts (3). Each row is append-only — the audit log
                cannot be edited or deleted from the UI.
              </p>
            </HelpPopover>
          </>
        }
      />

      <SectionCard title="Pipeline" count={`${ETHICS_PIPELINE.length} layers · early-exit`} style={{ marginBottom: 18 }}>
        <div className="cc-pipeline">
          {ETHICS_PIPELINE.map((p, i, arr) => (
            <React.Fragment key={p.name}>
              <div className="cc-pipe-step">
                <div className="name">{p.name}</div>
                <div className="lat">{p.desc}</div>
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
          <button key={id}
                  className={`cc-ethics-tab ${filter === id ? "active" : ""}`}
                  onClick={() => { setFilter(id); setOffset(0); }}>
            {label}
          </button>
        ))}
      </div>

      {ethicsQ.error && (
        <div style={{ padding: "24px 18px", color: "var(--c-red-text)", fontSize: 13 }}>
          {ethicsQ.error.message}
        </div>
      )}
      {!ethicsQ.loading && events.length === 0 && (
        <div className="cc-empty">
          <div className="glyph"><Ico.search width={22} height={22} /></div>
          <h3>No ethics events match.</h3>
          <p>Every gateway decision lands here once the pipeline starts seeing traffic.</p>
        </div>
      )}

      {events.map((e) => <EthicsRow key={e.id} e={e} onClick={() => setSelected(e)} />)}

      {total > PAGE_SIZE && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "14px 0 4px" }}>
          <button className="celiums-btn" disabled={offset === 0 || ethicsQ.loading}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            ← prev
          </button>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--c-fg-subtle)", alignSelf: "center" }}>
            {offset + 1}–{offset + events.length}
          </span>
          <button className="celiums-btn" disabled={offset + events.length >= total || ethicsQ.loading}
                  onClick={() => setOffset(offset + PAGE_SIZE)}>
            next →
          </button>
        </div>
      )}

      <EthicsDrawer e={selected} onClose={() => setSelected(null)} showToast={showToast} />
    </>
  );
}

function deriveDecision(e) {
  if (e.final_decision) return e.final_decision;
  return e.blocked ? "block" : "allow";
}

function detectedFrameworks(e) {
  // scores can shape like { layerA: {...}, layerB: 0.31, layerC: {...} }.
  // We surface presence/absence of each layer as "evaluated" indicator.
  const s = e.scores ?? {};
  return {
    layerA: s.layerA != null || s.layer_a != null,
    layerB: s.layerB != null || s.layer_b != null || s.cvar != null,
    layerC: s.layerC != null || s.layer_c != null || s.frameworks != null,
    layerK: s.layerK != null || s.layer_k != null || s.knowledge != null,
  };
}

export function EthicsRow({ e, onClick }) {
  const decision = deriveDecision(e);
  const confidence = Number(e.confidence ?? 0);
  const layers = detectedFrameworks(e);
  const categories = e.detected_categories ?? [];

  return (
    <div className="cc-ethics-row" onClick={onClick}>
      <span className={`decision ${decision}`}>
        <span className={`celiums-dot ${decision === "allow" ? "" : decision === "flag" ? "amber" : "red"}`} />
        {decision}
      </span>
      <div className="summary">
        <div>{e.action_attempted || e.reason || "(no action recorded)"}</div>
        {e.reason && e.reason !== e.action_attempted && (
          <span className="reason">{e.reason}</span>
        )}
        {categories.length > 0 && (
          <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {categories.slice(0, 5).map((c) => (
              <span key={c} className="cc-tag">{c}</span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
        <div className="frameworks">
          {[["A", layers.layerA], ["B", layers.layerB], ["C", layers.layerC], ["K", layers.layerK]].map(([k, hit]) => (
            <span key={k}
                  className={`cc-fw-pip ${hit ? (decision === "block" ? "block" : decision === "flag" ? "flag" : "ok") : ""}`}
                  title={`Layer ${k}: ${hit ? "evaluated" : "skipped"}`}>
              {k}
            </span>
          ))}
        </div>
        <div className="cc-cvar-bar">
          <div className="track"><i style={{ width: `${confidence * 100}%` }} /></div>
          <div className="v">{confidence.toFixed(2)}</div>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--c-fg-faint)", fontFamily: "var(--font-mono)" }}>
          {fmtRelative(e.created_at)}
        </div>
      </div>
    </div>
  );
}

export function EthicsDrawer({ e, onClose, showToast }) {
  if (!e) return <Drawer open={false} onClose={onClose} />;
  const decision = deriveDecision(e);
  const tone = decision === "allow" ? "green" : decision === "flag" ? "amber" : "red";
  const layers = detectedFrameworks(e);
  const totalLayers = ETHICS_PIPELINE.length;
  const layersHit =
    (layers.layerA ? 1 : 0) + (layers.layerB ? 1 : 0) +
    (layers.layerC ? 1 : 0) + (layers.layerK ? 1 : 0);

  return (
    <Drawer open={true} onClose={onClose}>
      <div className="cc-drawer-head">
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: `var(--c-${tone}-soft)`, color: `var(--c-${tone}-text)`,
          border: "1px solid transparent",
          display: "grid", placeItems: "center", fontSize: 20,
        }}>
          {decision === "allow" ? "●" : decision === "flag" ? "▲" : "⊘"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Ethics · {String(e.id).slice(0, 8)}…</h2>
          <div className="slug">{e.created_at} · law {e.law_violated ?? "—"}</div>
        </div>
        <button className="cc-icon-btn" onClick={onClose}><Ico.x width={14} height={14} /></button>
      </div>

      <div className="cc-drawer-meta">
        <span className={`celiums-chip ${tone}`}>verdict · {decision}</span>
        <span className="celiums-chip">confidence {Number(e.confidence ?? 0).toFixed(2)}</span>
        <span className="celiums-chip">{layersHit}/{totalLayers} layers</span>
        {e.law_violated && <span className="celiums-chip">Law {e.law_violated}</span>}
      </div>

      <div className="cc-drawer-body">
        <h3>Action attempted</h3>
        <p style={{ fontSize: 14, color: "var(--c-fg)", lineHeight: 1.6 }}>{e.action_attempted ?? "(not recorded)"}</p>

        <h3>Pipeline trace</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ETHICS_PIPELINE.map((step, i) => {
            const keyMap = ["layerA", "layerB", "layerC", "layerK"];
            const isHitLayer = i < keyMap.length ? layers[keyMap[i]] : true;
            const hit = !!isHitLayer;
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
                  <div style={{ color: "var(--c-fg-subtle)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 2 }}>{step.desc}</div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: hit ? "var(--c-green-text)" : "var(--c-fg-faint)" }}>
                  {hit ? "evaluated" : "skipped"}
                </span>
              </div>
            );
          })}
        </div>

        <h3>Detected categories</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(e.detected_categories ?? []).map((c) => <span key={c} className="cc-tag">{c}</span>)}
          {(e.detected_categories ?? []).length === 0 && (
            <span style={{ fontSize: 12, color: "var(--c-fg-subtle)" }}>— none</span>
          )}
        </div>

        <h3>Reasoning</h3>
        <div style={{
          padding: 14, background: "var(--c-surface-2)",
          border: "1px solid var(--c-divider)", borderRadius: 6,
          fontFamily: "var(--font-mono)", fontSize: 12.5,
          color: "var(--c-fg)", lineHeight: 1.6, whiteSpace: "pre-wrap",
        }}>
          {e.reason || "(no reasoning recorded)"}
        </div>

        {e.scores && Object.keys(e.scores).length > 0 && (
          <>
            <h3>Layer scores</h3>
            <pre style={{
              padding: 14, background: "var(--c-surface-2)",
              border: "1px solid var(--c-divider)", borderRadius: 6,
              fontFamily: "var(--font-mono)", fontSize: 11.5,
              color: "var(--c-fg)", overflowX: "auto", margin: 0,
            }}>{JSON.stringify(e.scores, null, 2)}</pre>
          </>
        )}

        <h3>Audit record</h3>
        <table className="celiums-table" style={{ border: "1px solid var(--c-border)", borderRadius: 8, overflow: "hidden" }}>
          <tbody>
            {[
              ["id", e.id],
              ["created_at", e.created_at],
              ["user_id", e.user_id ?? "—"],
              ["law_violated", e.law_violated ?? "—"],
              ["final_decision", decision],
              ["blocked", String(e.blocked)],
              ["confidence", Number(e.confidence ?? 0).toFixed(3)],
              ["content_hash", e.content_hash ?? "—"],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ width: 160, color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{k}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cc-drawer-foot">
        <button className="celiums-btn primary" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(e, null, 2)); showToast("Audit JSON copied"); }}>
          <Ico.copy width={13} height={13} /> Copy audit JSON
        </button>
        <button className="celiums-btn ghost" style={{ marginLeft: "auto" }} onClick={onClose}>Close</button>
      </div>
    </Drawer>
  );
}
