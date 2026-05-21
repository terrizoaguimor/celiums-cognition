/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState, useMemo, useEffect } from "react";
import { fetchJournal, fetchJournalAgents, fetchCounts, useQuery } from "./data.js";
import { Ico } from "./celiums-primitives.jsx";
import { Drawer, PageHead, SectionCard, StatusDot, HelpPopover, fmtCount } from "./cc-shell.jsx";

/* Journal tab — hash-chained first-person agent journal.
 * Each row carries prev_hash + hash; the chain can be re-verified by
 * recomputing sha256(prev_hash || canonicalize(body)) and matching. */

const PAGE_SIZE = 30;

export function Journal({ showToast }) {
  const [entryType, setEntryType] = useState("all");
  const [agentFilter, setAgentFilter] = useState(null); // null = all agents
  const [offset, setOffset] = useState(0);

  const agentsQ = useQuery(fetchJournalAgents, []);
  const allAgents = agentsQ.data?.agents ?? [];

  // Selected entry for the detail drawer (Mario 2026-05-21: click should
  // open the full entry, not just stare at a truncated preview).
  const [selectedEntry, setSelectedEntry] = useState(null);

  // Auto-pick the most-recent agent if "all" returns too noisy a mix;
  // operator can switch back via the sidebar.
  useEffect(() => {
    setOffset(0);
  }, [agentFilter, entryType]);

  const journalQ = useQuery(
    () => fetchJournal({
      limit: PAGE_SIZE,
      offset,
      agent_id: agentFilter || null,
      entry_type: entryType !== "all" ? entryType : null,
    }),
    [offset, agentFilter, entryType],
  );
  const countsQ = useQuery(fetchCounts, []);

  const allEntries = journalQ.data?.entries ?? [];
  const total = journalQ.data?.total ?? countsQ.data?.journal_entries ?? 0;
  // Server already filters by entry_type; we just pass the rows through.
  const entries = allEntries;

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
          <SectionCard
            title="Agents on this gateway"
            count={`${allAgents.length} voices`}
            action={<HelpPopover title="Per-agent journals">
              <p style={{ margin: "0 0 8px" }}>
                Each agent (main, subagents, external models) runs through
                this gateway has its OWN journal chain, scoped by
                <code> agent_id</code>. Their reflections never bleed
                into each other.
              </p>
              <p style={{ margin: "8px 0 0", color: "var(--c-fg-muted)" }}>
                The plugin's auto-journal writes one entry per meaningful
                turn; the agent itself can add finer entries via
                <code> journal_write</code>. The hash chain makes any
                retro-active edit detectable.
              </p>
            </HelpPopover>}>
            <div style={{ padding: "8px 0" }}>
              <AgentRow
                agent={{ agent_id: "All voices", total: allAgents.reduce((a, b) => a + (b.total || 0), 0) }}
                active={agentFilter === null}
                onClick={() => setAgentFilter(null)}
                isAll
              />
              {agentsQ.loading && <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--c-fg-subtle)" }}>loading…</div>}
              {!agentsQ.loading && allAgents.length === 0 && (
                <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--c-fg-subtle)" }}>
                  No agents have written yet.
                </div>
              )}
              {allAgents.map((a) => (
                <AgentRow
                  key={a.agent_id}
                  agent={a}
                  active={agentFilter === a.agent_id}
                  onClick={() => setAgentFilter(a.agent_id)}
                />
              ))}
            </div>
          </SectionCard>

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
              {agentFilter && (
                <span className="celiums-chip green" style={{ marginLeft: 6 }}>
                  agent: <code style={{ fontFamily: "var(--font-mono)" }}>{agentFilter}</code>
                </span>
              )}
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

          {entries.map((e) => (
            <JournalEntry key={e.id} e={e} showToast={showToast}
              onClick={() => setSelectedEntry(e)}
              selected={selectedEntry?.id === e.id} />
          ))}

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

      <JournalEntryDrawer
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
        showToast={showToast} />
    </>
  );
}

export function JournalEntry({ e, showToast, onClick, selected }) {
  const preview = (e.content ?? "").length > 320
    ? `${e.content.slice(0, 320)}…`
    : e.content;
  return (
    <div className="cc-journal-entry"
         onClick={onClick}
         style={{
           cursor: onClick ? "pointer" : "default",
           borderLeft: selected ? "3px solid var(--c-green)" : "3px solid transparent",
           background: selected ? "var(--c-hover)" : undefined,
           transition: "background 0.12s ease, border-color 0.12s ease",
         }}>
      <div className="head">
        <span className="seq">{short(e.id, 8)}</span>
        <span className="ts">{fmtTimestamp(e.written_at)}</span>
        <span className="celiums-chip green">{e.entry_type}</span>
        <span className="celiums-chip" style={{ fontFamily: "var(--font-mono)" }}>{e.agent_id}</span>
        {e.valence != null && (
          <span className="celiums-chip">v {Number(e.valence).toFixed(2)}</span>
        )}
        {(e.tags ?? []).slice(0, 4).map((t) => <span key={t} className="cc-tag">{t}</span>)}
      </div>
      <div className="body">{preview}</div>
      {e.valence_reason && (
        <div className="body" style={{ marginTop: 6, fontSize: 12.5, color: "var(--c-fg-muted)", fontStyle: "italic" }}>
          why: {e.valence_reason}
        </div>
      )}
      <div className="hash">
        <span><span style={{ color: "var(--c-fg-faint)" }}>hash </span><code>{short(e.hash)}</code></span>
        <span><span style={{ color: "var(--c-fg-faint)" }}>prev </span><code>{short(e.prev_hash) || "·"}</code></span>
        <a className="celiums-link" style={{ fontSize: 11.5 }}
          onClick={(ev) => {
            ev.stopPropagation();
            navigator.clipboard?.writeText(e.content);
            showToast(`Entry ${short(e.id, 6)} copied`);
          }}>
          ⧉ copy
        </a>
        {e.content && e.content.length > 320 && (
          <a className="celiums-link" style={{ fontSize: 11.5, color: "var(--c-green-text)" }}
             onClick={onClick}>
            open ↗
          </a>
        )}
      </div>
    </div>
  );
}

/* Drawer with the full entry + the entries it's preceded_by (causal
 * chain hint). When clicked from the feed, the operator can scan the
 * full body, copy parts, and verify the hash chain link to the previous
 * entry without leaving the tab. */
export function JournalEntryDrawer({ entry, onClose, showToast }) {
  if (!entry) return <Drawer open={false} onClose={onClose} />;
  const valence = Number(entry.valence ?? 0);
  const importance = Number(entry.importance ?? 0);
  return (
    <Drawer open={true} onClose={onClose}>
      <div className="cc-drawer-head">
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: "var(--c-surface-2)", border: "1px solid var(--c-divider)",
          display: "grid", placeItems: "center", color: "var(--c-fg-muted)",
          fontSize: 18, flexShrink: 0,
        }}>≡</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{entry.entry_type} · {short(entry.id, 10)}…</h2>
          <div className="slug" style={{ cursor: "pointer" }}
            onClick={() => { navigator.clipboard?.writeText(entry.id); showToast("Entry id copied"); }}>
            {entry.agent_id} · {fmtTimestamp(entry.written_at)}
          </div>
        </div>
        <button className="cc-icon-btn" onClick={onClose}><Ico.x width={14} height={14} /></button>
      </div>

      <div className="cc-drawer-meta">
        <span className="celiums-chip green">{entry.entry_type}</span>
        <span className="celiums-chip" style={{ fontFamily: "var(--font-mono)" }}>{entry.agent_id}</span>
        {entry.visibility && <span className="celiums-chip">{entry.visibility}</span>}
        {entry.valence != null && (
          <span className={`celiums-chip ${valence > 0.2 ? "green" : valence < -0.2 ? "amber" : ""}`}>
            valence {valence.toFixed(2)}
          </span>
        )}
        {entry.importance != null && (
          <span className="celiums-chip">importance {(importance * 100).toFixed(0)}</span>
        )}
        {(entry.tags ?? []).map((t) => <span key={t} className="cc-tag">{t}</span>)}
      </div>

      <div className="cc-drawer-body">
        <h3>Content</h3>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--c-fg)", whiteSpace: "pre-wrap" }}>
          {entry.content}
        </p>

        {entry.valence_reason && (
          <>
            <h3>Why this valence</h3>
            <p style={{ fontSize: 13, color: "var(--c-fg-muted)", lineHeight: 1.55, fontStyle: "italic" }}>
              {entry.valence_reason}
            </p>
          </>
        )}

        <h3>Hash chain</h3>
        <table className="celiums-table" style={{
          border: "1px solid var(--c-border)", borderRadius: 8, overflow: "hidden",
        }}>
          <tbody>
            {[
              ["hash", entry.hash],
              ["prev_hash", entry.prev_hash ?? "(genesis)"],
              ["session_id", entry.session_id ?? "—"],
              ["conversation_id", entry.conversation_id ?? "—"],
              ["agent_id", entry.agent_id],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ width: 140, color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{k}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, wordBreak: "break-all" }}>{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {Array.isArray(entry.preceded_by) && entry.preceded_by.length > 0 && (
          <>
            <h3>Preceded by</h3>
            <ul style={{ paddingLeft: 18, color: "var(--c-fg-muted)", fontSize: 12.5, fontFamily: "var(--font-mono)" }}>
              {entry.preceded_by.map((id) => (
                <li key={id} style={{ marginBottom: 4 }}>{short(id, 20)}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="cc-drawer-foot">
        <button className="celiums-btn primary" onClick={() => {
          navigator.clipboard?.writeText(entry.content);
          showToast("Content copied");
        }}>
          <Ico.copy width={13} height={13} /> Copy content
        </button>
        <button className="celiums-btn" onClick={() => {
          navigator.clipboard?.writeText(JSON.stringify(entry, null, 2));
          showToast("Entry JSON copied");
        }}>
          <Ico.copy width={13} height={13} /> Copy JSON
        </button>
        <button className="celiums-btn ghost" style={{ marginLeft: "auto" }} onClick={onClose}>Close</button>
      </div>
    </Drawer>
  );
}

/* Sidebar row for one agent — name, entry count, last-written, valence tint. */
function AgentRow({ agent, active, onClick, isAll }) {
  const total = Number(agent.total ?? 0);
  const valence = Number(agent.avg_valence ?? 0);
  // Border tint based on whether the agent's average valence skews
  // positive/negative — quick visual for "this voice is stressed".
  const valenceTint =
    !isAll && Number.isFinite(valence) && Math.abs(valence) > 0.15
      ? valence > 0
        ? "var(--c-green)"
        : "var(--c-amber-text)"
      : "transparent";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", width: "100%", alignItems: "center", gap: 8,
        padding: "8px 14px", border: 0, background: active ? "var(--c-hover)" : "transparent",
        cursor: "pointer", textAlign: "left", fontFamily: "inherit",
        borderLeft: `3px solid ${active ? "var(--c-green)" : valenceTint}`,
      }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 12.5, color: "var(--c-fg)", fontWeight: active ? 500 : 400,
          fontFamily: isAll ? "inherit" : "var(--font-mono)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {agent.agent_id}
        </div>
        {!isAll && agent.last_written_at && (
          <div style={{ fontSize: 10.5, color: "var(--c-fg-subtle)", marginTop: 1 }}>
            last {fmtRelativeShort(agent.last_written_at)}
            {Number.isFinite(valence) && Math.abs(valence) > 0.05 && (
              <span style={{ marginLeft: 6 }}>· v {valence.toFixed(2)}</span>
            )}
          </div>
        )}
      </div>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 11,
        color: "var(--c-fg-muted)", padding: "1px 6px",
        background: "var(--c-surface-2)", borderRadius: 4,
      }}>{total}</span>
    </button>
  );
}

function fmtRelativeShort(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const secs = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  } catch { return "—"; }
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
