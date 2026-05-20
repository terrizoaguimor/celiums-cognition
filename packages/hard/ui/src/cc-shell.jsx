import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
import { Avatar, CeliumsWordmark, Ico } from './celiums-primitives.jsx';
/* Celiums Cognition — plugin shell + primitives in the Celiums design language. */

/* ─────────────────────── Plugin nav data ─────────────────────── */
export const CC_ROUTES = [
  { id: "overview",  label: "Overview",  hint: "⌘1", icon: (p) =>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <rect x="2.5" y="2.5" width="5" height="5" rx=".5"/>
      <rect x="8.5" y="2.5" width="5" height="5" rx=".5"/>
      <rect x="2.5" y="8.5" width="5" height="5" rx=".5"/>
      <rect x="8.5" y="8.5" width="5" height="5" rx=".5"/>
    </svg>
  },
  { id: "skills",    label: "Skills",    hint: "⌘2", icon: (p) =>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <path d="M8 2L9.5 6L13.5 6L10.5 8.5L11.5 12.5L8 10.5L4.5 12.5L5.5 8.5L2.5 6L6.5 6L8 2Z" strokeLinejoin="round"/>
    </svg>
  },
  { id: "memories",  label: "Memories",  hint: "⌘3", icon: (p) =>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <path d="M3.5 6c0-1.4 1.1-2.5 2.5-2.5h4c1.4 0 2.5 1.1 2.5 2.5v4c0 1.4-1.1 2.5-2.5 2.5h-4C4.6 12.5 3.5 11.4 3.5 10z"/>
      <circle cx="8" cy="8" r="2"/>
    </svg>
  },
  { id: "journal",   label: "Journal",   hint: "⌘4", icon: (p) =>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <path d="M3.5 2.5h7l3 3v8a1 1 0 01-1 1H3.5a1 1 0 01-1-1V3.5a1 1 0 011-1z" strokeLinejoin="round"/>
      <path d="M5 7h6M5 10h4" strokeLinecap="round"/>
    </svg>
  },
  { id: "ethics",    label: "Ethics",    hint: "⌘5", icon: (p) =>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <path d="M8 2v12M3 5h10M4.5 5l-2 5h4l-2-5zM11.5 5l-2 5h4l-2-5z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  },
  { id: "settings",  label: "Settings",  hint: "⌘,", icon: (p) =>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <circle cx="8" cy="8" r="2"/>
      <path d="M8 1.5v1.7M8 12.8v1.7M2.6 4.5l1.5.85M11.9 10.65l1.5.85M1.5 8h1.7M12.8 8h1.7M2.6 11.5l1.5-.85M11.9 5.35l1.5-.85"/>
    </svg>
  },
];

/* ─────────────────────── Console shell (Celiums Cognition flavor) ─────────────────────── */
export function CCConsoleShell({ route, onNavigate, counts, health, theme = "light", user, children }) {
  return (
    <div className="celiums" data-theme={theme} style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Topbar */}
      <div style={{
        height: 52, flex: "0 0 52px",
        borderBottom: "1px solid var(--c-border)",
        background: "var(--c-bg)",
        display: "flex", alignItems: "center", padding: "0 18px", gap: 12,
      }}>
        <CeliumsWordmark size={20} />
        <span style={{ color: "var(--c-fg-faint)", fontSize: 14 }}>/</span>
        <button style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "transparent", border: 0, cursor: "pointer",
          padding: "5px 9px", borderRadius: 6,
          color: "var(--c-fg)", fontSize: 13.5, fontWeight: 500, fontFamily: "inherit",
        }}>
          Cognition
          <span style={{ color: "var(--c-fg-subtle)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
            plugin · v{health.version}
          </span>
          <Ico.chevDown width={11} height={11} style={{ opacity: .5 }} />
        </button>

        <div style={{ flex: 1 }} />

        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 11.5, color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)",
        }}>
          <span className={`celiums-dot ${health.allOk ? "" : "red"} live`} />
          <span>{health.allOk ? "stack healthy" : "stack issue"}</span>
          <span style={{ color: "var(--c-fg-faint)" }}>· polled 5s</span>
        </div>

        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "5px 10px", borderRadius: 6,
          border: "1px solid var(--c-border)",
          background: "var(--c-surface)",
          fontSize: 12, color: "var(--c-fg-subtle)",
          width: 220,
        }}>
          <Ico.search width={13} height={13} />
          <span>Search the corpus…</span>
          <span style={{ flex: 1 }} />
          <span className="celiums-kbd" style={{ borderBottomWidth: 1 }}>⌘K</span>
        </div>

        <Avatar name={user?.name || "Operator"} size={28} />
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <aside style={{
          width: 230, flex: "0 0 230px",
          borderRight: "1px solid var(--c-border)",
          background: "var(--c-surface-2)",
          display: "flex", flexDirection: "column",
          padding: "12px 12px",
        }}>
          <div className="cc-side-eyebrow">Plugin</div>
          {CC_ROUTES.map(r => {
            const Icon = r.icon;
            const count = countFor(r.id, counts);
            const active = route === r.id;
            return (
              <div key={r.id} className={`cc-nav-row ${active ? "active" : ""}`} onClick={() => onNavigate(r.id)}>
                <span className="ico"><Icon width={15} height={15} /></span>
                <span className="lbl">{r.label}</span>
                {count != null && <span className="ct">{count}</span>}
              </div>
            );
          })}

          <div className="cc-side-eyebrow" style={{ marginTop: 14 }}>Phase 2</div>
          <div className="cc-nav-row" style={{ opacity: 0.55, cursor: "not-allowed" }}>
            <span className="ico">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" width="15" height="15">
                <circle cx="5" cy="8" r="2"/><circle cx="11" cy="8" r="2"/><path d="M7 8h2"/>
              </svg>
            </span>
            <span className="lbl">Corpus federation</span>
            <span className="ct">soon</span>
          </div>
          <div className="cc-nav-row" style={{ opacity: 0.55, cursor: "not-allowed" }}>
            <span className="ico">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" width="15" height="15">
                <rect x="2.5" y="3.5" width="11" height="9" rx="1"/>
                <path d="M2.5 7h11"/>
              </svg>
            </span>
            <span className="lbl">Audit export</span>
            <span className="ct">soon</span>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ height: 1, background: "var(--c-divider)", margin: "10px 4px 8px" }} />
          <div style={{
            padding: "10px 10px", fontSize: 11.5, color: "var(--c-fg-muted)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span className={`celiums-dot ${health.allOk ? "" : "red"}`} />
            <div style={{ minWidth: 0, flex: 1, lineHeight: 1.3 }}>
              <div style={{ color: "var(--c-fg)", fontWeight: 500, fontSize: 12.5 }}>{user?.name || "Operator"}</div>
              <div style={{ color: "var(--c-fg-subtle)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {user?.email || "—"}
              </div>
            </div>
          </div>
        </aside>

        {/* Content well */}
        <main style={{ flex: 1, minWidth: 0, overflowY: "auto", background: "var(--c-bg)" }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 36px 80px" }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function countFor(id, counts) {
  if (!counts) return null;
  if (id === "skills")   return fmtCount(counts.skills);
  if (id === "memories") return fmtCount(counts.memories);
  if (id === "journal")  return fmtCount(counts.journal_entries);
  if (id === "ethics")   return fmtCount(counts.ethics_events);
  return null;
}

/* ─────────────────────── Page primitives ─────────────────────── */
export function PageHead({ eyebrow, title, sub, actions }) {
  return (
    <div className="cc-page-head">
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && <div className="celiums-eyebrow" style={{ marginBottom: 10 }}>{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function SectionCard({ title, count, action, padded = false, children, style }) {
  return (
    <div className="celiums-card" style={style}>
      {(title || action) && (
        <div className="celiums-card-header">
          <span className="celiums-eyebrow">{title}</span>
          {count != null && <span className="celiums-chip">{count}</span>}
          {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
        </div>
      )}
      {padded ? <div className="celiums-card-body">{children}</div> : children}
    </div>
  );
}

/* ─────────────────────── StatusDot ─────────────────────── */
export function StatusDot({ status = "ok", live = false }) {
  const cls = status === "ok" ? "" : status === "err" ? "red" : status === "warn" ? "amber" : "muted";
  return <span className={`celiums-dot ${cls} ${live ? "live" : ""}`} />;
}

/* ─────────────────────── Sparkline (green) ─────────────────────── */
export function Sparkline({ data, height = 26 }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100, h = height;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const fillPts = `0,${h} ${pts} ${w},${h}`;
  const gradId = "sg-" + Math.floor(Math.random() * 1e6);
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height, width: "100%" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--c-green)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--c-green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke="var(--c-green)" strokeWidth="1.5" />
    </svg>
  );
}

/* ─────────────────────── Toast ─────────────────────── */
export function Toast({ open, message }) {
  return (
    <div className={`cc-toast ${open ? "show" : ""}`}>
      <span className="check">✓</span>
      <span>{message}</span>
    </div>
  );
}

/* ─────────────────────── Number formatters ─────────────────────── */
export function fmtCount(n) {
  if (n == null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return n.toLocaleString();
}
export function fmtBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}
export function fmtRelative(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ─────────────────────── Markdown view ─────────────────────── */
export function MarkdownView({ text }) {
  const lines = text.split("\n");
  const out = [];
  lines.forEach((ln, i) => {
    if (ln.startsWith("# ")) {
      out.push(<div key={i} className="h1">{ln.slice(2)}</div>);
    } else if (ln.startsWith("## ")) {
      out.push(<div key={i} className="h2" style={{ marginTop: 14 }}>{ln.slice(3)}</div>);
    } else if (ln.startsWith("- ")) {
      out.push(<div key={i}>• {ln.slice(2)}</div>);
    } else if (ln.startsWith("|")) {
      out.push(<div key={i} style={{ color: "var(--c-fg-muted)" }}>{ln}</div>);
    } else {
      const parts = [];
      let rest = ln;
      let key = 0;
      while (rest.length) {
        const m = rest.match(/`([^`]+)`/);
        if (!m) { parts.push(rest); break; }
        parts.push(rest.slice(0, m.index));
        parts.push(<span key={key++} className="code">{m[1]}</span>);
        rest = rest.slice(m.index + m[0].length);
      }
      out.push(<div key={i}>{parts.length ? parts : "\u00A0"}</div>);
    }
  });
  return <div className="cc-content-md">{out}</div>;
}

/* ─────────────────────── Drawer ─────────────────────── */
export function Drawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <>
      <div className={`cc-scrim ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`cc-drawer ${open ? "open" : ""}`}>{open && children}</aside>
    </>
  );
}

Object.assign(window, {
  CCConsoleShell, PageHead, SectionCard, StatusDot, Sparkline, Toast,
  fmtCount, fmtBytes, fmtRelative, MarkdownView, Drawer, CC_ROUTES,
});
