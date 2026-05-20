import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
import { ENV_GROUPS } from './data.js';
import { PageHead, SectionCard } from './cc-shell.jsx';
/* Settings tab — operator-facing CELIUMS_* config editor. */

export function Settings({ showToast }) {
  const groups = MOCK_DATA.ENV_GROUPS;
  const [active, setActive] = useState(groups[0].id);
  const [values, setValues] = useState(() => {
    const v = {};
    groups.forEach(g => g.items.forEach(it => { v[it.key] = it.value; }));
    return v;
  });
  const [dirty, setDirty] = useState(new Set());

  const update = (k, v) => {
    setValues(prev => ({ ...prev, [k]: v }));
    setDirty(prev => new Set([...prev, k]));
  };

  const save = () => {
    showToast(`Saved ${dirty.size} change${dirty.size === 1 ? "" : "s"} · restart not required`);
    setDirty(new Set());
  };

  const revert = () => {
    const v = {};
    groups.forEach(g => g.items.forEach(it => { v[it.key] = it.value; }));
    setValues(v);
    setDirty(new Set());
  };

  return (
    <>
      <PageHead
        eyebrow="Operator settings · ~/.openclaw/plugins/celiums-cognition/env"
        title="Settings"
        sub={<>CELIUMS_* environment variables. Changes apply live; no restart needed.</>}
        actions={
          <>
            {dirty.size > 0 && <span className="celiums-chip amber">{dirty.size} unsaved</span>}
            <button className="celiums-btn" onClick={revert} disabled={dirty.size === 0}>Revert</button>
            <button className="celiums-btn primary" onClick={save} disabled={dirty.size === 0}>Save changes</button>
          </>
        }
      />

      <div className="cc-settings-grid">
        <aside className="cc-settings-nav">
          {groups.map(g => (
            <div key={g.id} className={`item ${active === g.id ? "active" : ""}`}
              onClick={() => {
                setActive(g.id);
                document.getElementById(`grp-${g.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
              }}>
              <span style={{ width: 16, textAlign: "center", color: "var(--c-fg-faint)" }}>{g.icon}</span>
              <span>{g.label}</span>
            </div>
          ))}

          <div style={{ borderTop: "1px solid var(--c-divider)", margin: "12px 0 8px" }} />

          <div className="item" onClick={() => {
            if (confirm("Sign out of this gateway? You'll need your password + 2FA to come back.")) {
              localStorage.removeItem("celiums.session");
              window.location.reload();
            }
          }}>
            <span style={{ width: 16, textAlign: "center" }}>↩</span>
            <span>Sign out</span>
          </div>
          <div className="item" style={{ color: "var(--c-red-text)" }} onClick={() => {
            if (confirm("Reset all plugin state including operator account? Cannot be undone.")) {
              localStorage.clear();
              window.location.reload();
            }
          }}>
            <span style={{ width: 16, textAlign: "center" }}>⊘</span>
            <span>Reset plugin</span>
          </div>
        </aside>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map(g => (
            <div key={g.id} id={`grp-${g.id}`}>
              <SectionCard title={`${g.icon}  ${g.label}`} count={g.items.length}>
                {g.items.map(it => (
                  <EnvRow key={it.key} item={it} value={values[it.key]} dirty={dirty.has(it.key)}
                    onChange={v => update(it.key, v)} />
                ))}
              </SectionCard>
            </div>
          ))}

          <SectionCard title="⛨  Authentication">
            <div style={{ padding: 16 }}>
              {[
                { t: "Two-factor authentication", d: "TOTP via your authenticator app", chip: <span className="celiums-chip green">enabled</span> },
                { t: "Recovery codes", d: "8 codes generated · 8 unused", chip: <button className="celiums-btn sm">Regenerate</button> },
                { t: "Operator password", d: "Hashed with argon2id", chip: <button className="celiums-btn sm">Change</button> },
              ].map((row, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "12px 0", borderTop: i > 0 ? "1px solid var(--c-divider)" : "none",
                }}>
                  <div>
                    <div style={{ color: "var(--c-fg)", fontWeight: 500, fontSize: 13.5 }}>{row.t}</div>
                    <div style={{ fontSize: 12, color: "var(--c-fg-subtle)", marginTop: 2 }}>{row.d}</div>
                  </div>
                  {row.chip}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="◌  Danger zone" style={{ borderColor: "rgba(220,80,80,0.25)" }}>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <DangerRow
                title="Re-index seed corpus"
                desc="Drops & rebuilds the HNSW index. ~3min for 10k modules. Search degraded during rebuild."
                cta="Re-index" />
              <DangerRow
                title="Wipe memories"
                desc="Permanently deletes all entries in the memories table. Cannot be recovered."
                cta="Wipe" danger />
              <DangerRow
                title="Truncate journal"
                desc="Truncates the journal hash chain back to genesis. Audit history will be lost."
                cta="Truncate" danger />
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

export function EnvRow({ item, value, dirty, onChange }) {
  return (
    <div className="cc-env-row" style={dirty ? { background: "rgba(245,158,11,0.04)" } : null}>
      <div>
        <div className="k">{item.key}</div>
        <div className="desc">{item.desc}</div>
      </div>
      <div>
        {item.kind === "text" && (
          <input className="celiums-input mono" style={{ padding: "7px 10px", fontSize: 12 }}
            type="text" value={value || ""} placeholder={item.placeholder || ""}
            onChange={e => onChange(e.target.value)} />
        )}
        {item.kind === "secret" && (
          <input className="celiums-input mono" style={{ padding: "7px 10px", fontSize: 12 }}
            type="password" value={value || ""} placeholder={item.placeholder || ""}
            onChange={e => onChange(e.target.value)} />
        )}
        {item.kind === "select" && (
          <select className="celiums-input mono" style={{ padding: "7px 10px", fontSize: 12 }}
            value={value} onChange={e => onChange(e.target.value)}>
            {item.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        )}
        {item.kind === "toggle" && (
          <label className="cc-switch">
            <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
            <span className="slot" />
          </label>
        )}
      </div>
      <div className={`badge ${dirty ? "modified" : ""}`}>
        {dirty ? <>● modified</> : <>default</>}
      </div>
    </div>
  );
}

export function DangerRow({ title, desc, cta, danger }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      gap: 16, padding: "12px 14px",
      background: danger ? "var(--c-red-soft)" : "var(--c-surface-2)",
      border: `1px solid ${danger ? "transparent" : "var(--c-divider)"}`,
      borderRadius: 8,
    }}>
      <div>
        <div style={{ color: "var(--c-fg)", fontSize: 13.5, fontWeight: 500 }}>{title}</div>
        <div style={{ color: "var(--c-fg-muted)", fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
      </div>
      <button className={`celiums-btn ${danger ? "danger" : ""}`}>{cta}</button>
    </div>
  );
}

Object.assign(window, { Settings });
