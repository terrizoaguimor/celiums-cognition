/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState, useMemo } from "react";
import { fetchJournal, fetchCounts, useQuery } from "./data.js";
import { Ico } from "./celiums-primitives.jsx";
import { PageHead, SectionCard, StatusDot, HelpPopover, fmtCount } from "./cc-shell.jsx";

/* Journal tab — hash-chained first-person agent journal.
 * Each row carries prev_hash + hash; the chain can be re-verified by
 * recomputing sha256(prev_hash || canonicalize(body)) and matching. */

const PAGE_SIZE = 30;

export function Journal({ showToast }) {
  const [entryType, setEntryType] = useState("all");
  const [offset, setOffset] = useState(0);

  const journalQ = useQuery(
    () => fetchJournal({ limit: PAGE_SIZE, offset }),
    [offset],
  );
  const countsQ = useQuery(fetchCounts, []);

  const allEntries = journalQ.data?.entries ?? [];
  const total = journalQ.data?.total ?? countsQ.data?.journal_entries ?? 0;

  const entries = useMemo(() => {
    if (entryType === "all") return allEntries;
    return allEntries.filter((e) => e.entry_type === entryType);
  }, [allEntries, entryType]);

  // Entry-type distribution from the page we have (informative, not exact)
  const typeDistribution = useMemo(() => {
    const counts = new Map();
    for (const e of allEntries) {
      counts.set(e.entry_type, (counts.get(e.entry_type) ?? 0) + 1);
    }
    const total = allEntries.length || 1;
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => [k, n / total]);
  }, [allEntries]);

  const latest = allEntries[0];

  return (
    <>
      <PageHead
        eyebrow="First-person reflection · tamper-evident"
        title="Journal"
        sub={<>Sealed entry by entry with a cumulative SHA-256 hash. Append-only. The agent writes here after every meaningful exchange.</>}
        actions={
          <>
            <span className="celiums-chip green">SHA-256</span>
            <span className="celiums-chip">append-only</span>
            <HelpPopover title="Tamper-evident journal chain">
              <p style={{ margin: "0 0 8px" }}>
                After every meaningful exchange, the agent appends a
                first-person reflection here. Each row carries
                <code> hash = SHA-256(prev_hash ∥ canonicalize(body))</code>,
                so any retroactive edit to an entry — even one that compiles
                cleanly into the same column types — breaks the chain.
              </p>
              <p style={{ margin: "8px 0" }}>
                <strong>Entry types:</strong>
              </p>
              <ul style={{ margin: "8px 0", paddingLeft: 18, lineHeight: 1.55, fontSize: 12 }}>
                <li><code>reflection</code> — a thought about how a session went</li>
                <li><code>decision</code> — a choice the agent committed to</li>
                <li><code>lesson</code> — a heuristic worth carrying forward</li>
                <li><code>belief</code> — a stated position about the world or the user</li>
                <li><code>emotion</code> — affect snapshot worth preserving</li>
                <li><code>arc</code> — narrative thread spanning several sessions</li>
                <li><code>doubt</code> — something the agent isn't sure about and wants flagged</li>
              </ul>
              <p style={{ margin: "8px 0 0", color: "var(--c-fg-muted)" }}>
                <code>valence</code> is the agent's felt sense of the entry
                (−1…+1). <code>valence_reason</code> is its own one-line
                justification — useful when reading back why it felt the
                way it did. <code>preceded_by</code> threads multi-step
                reasoning into a DAG, not just a chain.
              </p>
            </HelpPopover>
          </>
        }
      />

      <div className="cc-journal-wrap">
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionCard title="Hash chain" count={`${fmtCount(total)} entries`}>
            <div style={{ padding: 16 }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 12px", borderRadius: 8,
                background: "var(--c-green-soft)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8,
                              fontSize: 13, color: "var(--c-green-text)", fontWeight: 500 }}>
                  <StatusDot status="ok" live={true} />
                  Append-only · DB chain
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--c-green-text)" }}>
                  {fmtCount(total)} entries
                </span>
              </div>
              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 8, fontSize: 12 }}>
                <div style={{ color: "var(--c-fg-muted)" }}>last sealed</div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>
                  {latest ? fmtTime(latest.written_at) : "—"}
                </div>
                <div style={{ color: "var(--c-fg-muted)" }}>last hash</div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {latest ? short(latest.hash) : "—"}
                </div>
                <div style={{ color: "var(--c-fg-muted)" }}>algorithm</div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>SHA-256(prev∥body)</div>
              </div>
              <button className="celiums-btn full" style={{ marginTop: 14 }} disabled
                      title="Client-side chain verification: not implemented yet">
                ↻ Re-verify chain (TODO)
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Entry type · current page">
            <div style={{ padding: "12px 16px" }}>
              {typeDistribution.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--c-fg-subtle)" }}>—</div>
              )}
              {typeDistribution.map(([k, v]) => (
                <div key={k} className="cc-pillar-row" style={{ gridTemplateColumns: "110px 1fr 38px" }}>
                  <div className="name">{k}</div>
                  <div className="track"><i style={{ width: `${v * 100}%` }} /></div>
                  <div className="num">{Math.round(v * 100)}%</div>
                </div>
              ))}
            </div>
          </SectionCard>
        </aside>

        <div>
          <div className="cc-results-head">
            <div className="left">
              <span className="count">{entries.length}</span>
              <span>of {fmtCount(total)}</span>
            </div>
            <div className="cc-sort">
              <span style={{ fontSize: 11, color: "var(--c-fg-subtle)" }}>Type</span>
              <select value={entryType} onChange={(e) => setEntryType(e.target.value)}>
                <option value="all">All types</option>
                <option value="reflection">reflection</option>
                <option value="decision">decision</option>
                <option value="lesson">lesson</option>
                <option value="belief">belief</option>
                <option value="emotion">emotion</option>
                <option value="arc">arc</option>
                <option value="doubt">doubt</option>
              </select>
            </div>
          </div>

          {journalQ.error && (
            <div style={{ padding: "24px 18px", color: "var(--c-red-text)", fontSize: 13 }}>
              {journalQ.error.message}
            </div>
          )}
          {!journalQ.loading && entries.length === 0 && (
            <div className="cc-empty">
              <div className="glyph"><Ico.search width={22} height={22} /></div>
              <h3>No journal entries.</h3>
              <p>The agent writes here after reflecting on a conversation.</p>
            </div>
          )}

          {entries.map((e) => <JournalEntry key={e.id} e={e} showToast={showToast} />)}

          {total > PAGE_SIZE && (
            <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "14px 0 4px" }}>
              <button className="celiums-btn" disabled={offset === 0 || journalQ.loading}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                ← prev
              </button>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--c-fg-subtle)", alignSelf: "center" }}>
                {offset + 1}–{offset + allEntries.length}
              </span>
              <button className="celiums-btn" disabled={offset + allEntries.length >= total || journalQ.loading}
                      onClick={() => setOffset(offset + PAGE_SIZE)}>
                next →
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function JournalEntry({ e, showToast }) {
  return (
    <div className="cc-journal-entry">
      <div className="head">
        <span className="seq">{short(e.id, 8)}</span>
        <span className="ts">{fmtTimestamp(e.written_at)}</span>
        <span className="celiums-chip green">{e.entry_type}</span>
        {e.valence != null && (
          <span className="celiums-chip">v {Number(e.valence).toFixed(2)}</span>
        )}
        {(e.tags ?? []).slice(0, 4).map((t) => <span key={t} className="cc-tag">{t}</span>)}
      </div>
      <div className="body">{e.content}</div>
      {e.valence_reason && (
        <div className="body" style={{ marginTop: 6, fontSize: 12.5, color: "var(--c-fg-muted)", fontStyle: "italic" }}>
          why: {e.valence_reason}
        </div>
      )}
      <div className="hash">
        <span><span style={{ color: "var(--c-fg-faint)" }}>hash </span><code>{short(e.hash)}</code></span>
        <span><span style={{ color: "var(--c-fg-faint)" }}>prev </span><code>{short(e.prev_hash) || "·"}</code></span>
        <a className="celiums-link" style={{ fontSize: 11.5 }}
          onClick={() => { navigator.clipboard?.writeText(e.content); showToast(`Entry ${short(e.id, 6)} copied`); }}>
          ⧉ copy
        </a>
      </div>
    </div>
  );
}

function short(s, n = 16) {
  if (!s) return "";
  const txt = String(s);
  return txt.length > n ? txt.slice(0, n) + "…" : txt;
}
function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return "—"; }
}
function fmtTimestamp(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  } catch { return "—"; }
}
