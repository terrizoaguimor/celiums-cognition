import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
import { MOCK_COUNTS, MOCK_JOURNAL } from './data.js';
import { Ico } from './celiums-primitives.jsx';
import { PageHead, SectionCard, StatusDot } from './cc-shell.jsx';
/* Journal tab — hash-chained first-person agent journal. */

export function Journal({ showToast }) {
  const entries = MOCK_DATA.MOCK_JOURNAL;
  const [verifying, setVerifying] = useState(false);
  const [chainOk, setChainOk] = useState(true);

  const verifyChain = () => {
    setVerifying(true);
    setTimeout(() => { setVerifying(false); setChainOk(true); showToast("Chain verified · 847 entries"); }, 1100);
  };

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
          </>
        }
      />

      <div className="cc-journal-wrap">
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionCard title="Hash chain" count={`${fmtCount(MOCK_DATA.MOCK_COUNTS.journal_entries)} entries`}>
            <div style={{ padding: 16 }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 12px", borderRadius: 8,
                background: chainOk ? "var(--c-green-soft)" : "var(--c-amber-soft)",
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 13, color: chainOk ? "var(--c-green-text)" : "var(--c-amber-text)",
                  fontWeight: 500,
                }}>
                  <StatusDot status={chainOk ? "ok" : "warn"} live={chainOk} />
                  {chainOk ? "Verified" : "Recheck needed"}
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: chainOk ? "var(--c-green-text)" : "var(--c-amber-text)" }}>
                  847 entries
                </span>
              </div>
              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "100px 1fr", rowGap: 8, fontSize: 12 }}>
                <div style={{ color: "var(--c-fg-muted)" }}>last seq</div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>#847</div>
                <div style={{ color: "var(--c-fg-muted)" }}>last sealed</div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>12:42:18 UTC</div>
                <div style={{ color: "var(--c-fg-muted)" }}>genesis</div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>2026-01-12</div>
                <div style={{ color: "var(--c-fg-muted)" }}>algorithm</div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>SHA-256(prev∥body)</div>
              </div>
              <button className="celiums-btn full" style={{ marginTop: 14 }} onClick={verifyChain} disabled={verifying}>
                {verifying ? "Verifying…" : "↻ Re-verify chain"}
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Affect distribution">
            <div style={{ padding: "12px 16px" }}>
              {[
                ["curious", 0.32],
                ["reflective", 0.21],
                ["humble", 0.14],
                ["warm", 0.11],
                ["alert", 0.09],
                ["other", 0.13],
              ].map(([k, v]) => (
                <div key={k} className="cc-pillar-row" style={{ gridTemplateColumns: "100px 1fr 38px" }}>
                  <div className="name">{k}</div>
                  <div className="track"><i style={{ width: `${v * 100}%` }} /></div>
                  <div className="num">{Math.round(v * 100)}%</div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Export">
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <button className="celiums-btn"><Ico.download width={13} height={13} /> JSONL · full chain</button>
              <button className="celiums-btn"><Ico.download width={13} height={13} /> Verify pack (Merkle)</button>
              <button className="celiums-btn ghost"><Ico.external width={13} height={13} /> Pin to IPFS</button>
            </div>
          </SectionCard>
        </aside>

        <div>
          <div className="cc-results-head">
            <div className="left">
              <span className="count">{entries.length}</span>
              <span>most recent of {fmtCount(MOCK_DATA.MOCK_COUNTS.journal_entries)}</span>
            </div>
            <div className="cc-sort">
              <span style={{ fontSize: 11, color: "var(--c-fg-subtle)" }}>Filter</span>
              <select>
                <option>All affects</option>
                <option>curious</option>
                <option>reflective</option>
                <option>self-critical</option>
              </select>
            </div>
          </div>

          {entries.map(e => <JournalEntry key={e.seq} e={e} showToast={showToast} />)}

          <div style={{ textAlign: "center", color: "var(--c-fg-faint)", fontSize: 12, padding: "12px 0", fontFamily: "var(--font-mono)" }}>
            … 839 earlier entries
          </div>
        </div>
      </div>
    </>
  );
}

export function JournalEntry({ e, showToast }) {
  return (
    <div className="cc-journal-entry">
      <div className="head">
        <span className="seq">#{e.seq}</span>
        <span className="ts">{e.ts.replace("T", " ").replace("Z", " UTC")}</span>
        <span className="celiums-chip green">{e.affect}</span>
      </div>
      <div className="body">{e.text}</div>
      <div className="hash">
        <span><span style={{ color: "var(--c-fg-faint)" }}>hash </span><code>{e.hash}</code></span>
        <span><span style={{ color: "var(--c-fg-faint)" }}>prev </span><code>{e.prev}</code></span>
        {e.verified && (
          <span className="verified">
            <Ico.check width={11} height={11} /> verified
          </span>
        )}
        <a className="celiums-link" style={{ fontSize: 11.5 }}
          onClick={() => { navigator.clipboard?.writeText(e.text); showToast(`Entry #${e.seq} copied`); }}>
          ⧉ copy
        </a>
      </div>
    </div>
  );
}

Object.assign(window, { Journal });
