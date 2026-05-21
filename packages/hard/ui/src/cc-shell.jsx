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
  { id: "docs",      label: "Docs",      hint: "⌘6", icon: (p) =>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <path d="M3 2.5h7.5L13 5v8.5a1 1 0 01-1 1H3a1 1 0 01-1-1v-10a1 1 0 011-1z" strokeLinejoin="round"/>
      <path d="M10 2.5V5h3M4.5 7.5h7M4.5 10h5" strokeLinecap="round"/>
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
export function CCConsoleShell({
  route, onNavigate, counts, health, theme = "light", user, children,
  onLogout, onOpenPalette, onToggleTheme, routeRef,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Close the off-canvas nav after a route change.
  useEffect(() => { setMobileNavOpen(false); }, [route]);
  return (
    <div className="celiums celiums-shell"
         data-theme={theme}
         data-mobile-nav={mobileNavOpen ? "open" : "closed"}
         style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Topbar */}
      <div style={{
        height: 52, flex: "0 0 52px",
        borderBottom: "1px solid var(--c-border)",
        background: "var(--c-bg)",
        display: "flex", alignItems: "center", padding: "0 18px", gap: 12,
      }}>
        <button
          type="button"
          aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMobileNavOpen((v) => !v)}
          className="cc-mobile-nav-toggle"
          style={{
            display: "none", /* shown only on mobile via CSS */
            background: "transparent", border: 0, cursor: "pointer",
            color: "var(--c-fg)", padding: 6, marginRight: 4,
            fontSize: 18, lineHeight: 1, fontFamily: "inherit",
          }}>
          {mobileNavOpen ? "✕" : "☰"}
        </button>
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
            plugin · v{health?.version ?? "…"}
          </span>
          <Ico.chevDown width={11} height={11} style={{ opacity: .5 }} />
        </button>

        <div style={{ flex: 1 }} />

        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 11.5, color: "var(--c-fg-muted)", fontFamily: "var(--font-mono)",
        }}>
          <span className={`celiums-dot ${health?.allOk ? "" : "red"} live`} />
          <span>{health == null ? "checking…" : (health.allOk ? "stack healthy" : "stack issue")}</span>
          <span style={{ color: "var(--c-fg-faint)" }}>· polled 5s</span>
        </div>

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Open command palette"
          className="cc-topbar-search"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "5px 10px", borderRadius: 6,
            border: "1px solid var(--c-border)",
            background: "var(--c-surface)",
            fontSize: 12, color: "var(--c-fg-subtle)",
            width: 220,
            cursor: "pointer",
            fontFamily: "inherit",
          }}>
          <Ico.search width={13} height={13} />
          <span>Search the corpus…</span>
          <span style={{ flex: 1 }} />
          <span className="celiums-kbd" style={{ borderBottomWidth: 1 }}>⌘K</span>
        </button>

        <UserMenu user={user} theme={theme} onLogout={onLogout} onToggleTheme={onToggleTheme} />
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {/* Mobile scrim — clicking outside the sidebar closes it */}
        {mobileNavOpen && (
          <div onClick={() => setMobileNavOpen(false)}
               className="cc-mobile-scrim"
               style={{
                 display: "none", /* shown only on mobile via CSS */
                 position: "fixed", inset: "52px 0 0 0", zIndex: 55,
                 background: "rgba(10,12,11,0.4)",
                 backdropFilter: "blur(2px)",
                 WebkitBackdropFilter: "blur(2px)",
               }} />
        )}
        {/* Sidebar */}
        <aside className="cc-sidebar"
               style={{
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
            <span className={`celiums-dot ${health?.allOk ? "" : "red"}`} />
            <div style={{ minWidth: 0, flex: 1, lineHeight: 1.3 }}>
              <div style={{ color: "var(--c-fg)", fontWeight: 500, fontSize: 12.5 }}>{user?.name || "Operator"}</div>
              <div style={{ color: "var(--c-fg-subtle)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {user?.email || "—"}
              </div>
            </div>
          </div>
        </aside>

        {/* Content well — `celiums-scroll` is the hook target Lenis
            attaches its smooth-scroll instance to. */}
        <main className="celiums-scroll"
              style={{ flex: 1, minWidth: 0, overflowY: "auto", background: "var(--c-bg)" }}>
          <div ref={routeRef}
               style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 36px 80px" }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ─────────────────────── User menu (avatar dropdown) ─────────────────────── */
export function UserMenu({ user, theme, onLogout, onToggleTheme }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const isDark = theme === "dark";
  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open user menu"
        aria-expanded={open}
        style={{
          background: "transparent", border: 0, cursor: "pointer", padding: 0,
          borderRadius: "50%",
          outline: open ? "2px solid var(--c-green)" : "none",
          outlineOffset: 2,
        }}>
        <Avatar name={user?.name || "Operator"} size={28} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50,
          minWidth: 240,
          background: "var(--c-glass-strong)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
          border: "1px solid transparent",
          borderImage: "var(--celiums-grad-strong) 1",
          borderRadius: 10,
          boxShadow: "0 14px 32px rgba(0,0,0,0.16)",
          padding: 6,
          fontSize: 13,
        }}>
          <div style={{
            padding: "8px 10px 6px",
            borderBottom: "1px solid var(--c-divider)",
            marginBottom: 4,
          }}>
            <div style={{ fontWeight: 500, color: "var(--c-fg)" }}>{user?.name || "Operator"}</div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 11,
              color: "var(--c-fg-subtle)", marginTop: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {user?.email || "—"}
            </div>
          </div>

          {onToggleTheme && (
            <MenuItem onClick={() => { onToggleTheme(); setOpen(false); }}>
              <span style={{ width: 16, textAlign: "center" }}>{isDark ? "☀" : "☾"}</span>
              <span>{isDark ? "Light mode" : "Dark mode"}</span>
            </MenuItem>
          )}
          <MenuItem onClick={() => { window.location.hash = "settings"; setOpen(false); }}>
            <span style={{ width: 16, textAlign: "center" }}>⚙</span>
            <span>Settings</span>
            <span style={{ flex: 1 }} />
            <span className="celiums-kbd" style={{ fontSize: 10 }}>⌘,</span>
          </MenuItem>

          <div style={{ height: 1, background: "var(--c-divider)", margin: "4px 0" }} />

          <MenuItem onClick={() => { onLogout?.(); setOpen(false); }} danger>
            <span style={{ width: 16, textAlign: "center" }}>↩</span>
            <span>Sign out</span>
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "8px 10px",
        background: "transparent", border: 0, cursor: "pointer",
        borderRadius: 4,
        color: danger ? "var(--c-red-text)" : "var(--c-fg)",
        fontFamily: "inherit", fontSize: 13, textAlign: "left",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
      {children}
    </button>
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

/* ─────────────────────── HelpPopover (inline docs) ─────────────────────── */
/**
 * Small "?" button that pops a panel with an explanation. Use it on
 * dense pages where the meaning of a column or axis isn't obvious
 * (PAD bars, ethics pipeline, hash chain, etc).
 */
export function HelpPopover({ title, children }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);
  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-label={`Help: ${title}`}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 22, height: 22, borderRadius: "50%",
          border: "1px solid var(--c-border)",
          background: open ? "var(--c-hover)" : "var(--c-surface)",
          color: "var(--c-fg-muted)",
          cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontFamily: "inherit",
        }}>?</button>
      {open && (
        <div role="dialog" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40,
          width: 380, maxWidth: "calc(100vw - 32px)",
          maxHeight: "min(70vh, 520px)",
          display: "flex", flexDirection: "column",
          background: "var(--c-glass-strong)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
          border: "1px solid transparent",
          borderImage: "var(--celiums-grad-strong) 1",
          borderRadius: 8,
          boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
          fontSize: 12.5, lineHeight: 1.55, color: "var(--c-fg)",
          overflow: "hidden",
        }}>
          <div style={{
            fontWeight: 500, color: "var(--c-fg)",
            padding: "12px 14px",
            borderBottom: "1px solid var(--c-divider)",
            fontSize: 13,
            background: "var(--c-surface)",
            flex: "0 0 auto",
          }}>{title}</div>
          <div style={{
            padding: "12px 14px",
            overflowY: "auto",
            flex: "1 1 auto",
          }}>
            {children}
          </div>
        </div>
      )}
    </span>
  );
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
  // Sanitize: a single-element or zero-element dataset can't form a
  // line, and any non-finite value (NaN/Infinity) poisons the polyline
  // attribute. Drop those rather than emit `"NaN,24"` to the DOM.
  const safe = Array.isArray(data)
    ? data.filter((v) => typeof v === "number" && Number.isFinite(v))
    : [];
  if (safe.length === 0) return null;
  // Single-point chart: render a flat dot at mid-height — informative
  // without dividing by zero.
  const w = 100;
  const h = height;
  if (safe.length === 1) {
    const y = h / 2;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
        <circle cx={w / 2} cy={y} r="2" fill="var(--c-green)" />
      </svg>
    );
  }
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const range = max - min || 1;
  const step = w / (safe.length - 1);
  const pts = safe.map((v, i) => {
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
// Backed by react-markdown + remark-gfm (tables, strikethrough, task lists,
// autolinks). The previous hand-rolled parser handled headings + bullets
// + inline code only — react-markdown is ~30KB gz but lets skill bodies,
// memory content, and docs render as authored (tables, code blocks,
// nested lists, footnotes).
import _ReactMarkdown from "react-markdown";
import _remarkGfm from "remark-gfm";

export function MarkdownView({ text }) {
  return (
    <div className="cc-md">
      <_ReactMarkdown
        remarkPlugins={[_remarkGfm]}
        components={{
          // Heading mapping to existing celiums tokens so light/dark
          // theming + spacing match the rest of the surface.
          h1: ({ node, ...p }) => <h1 className="celiums-h2" style={{ margin: "20px 0 10px" }} {...p} />,
          h2: ({ node, ...p }) => <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--c-fg)", margin: "18px 0 8px" }} {...p} />,
          h3: ({ node, ...p }) => <h3 style={{ fontSize: 14, fontWeight: 500, color: "var(--c-fg)", margin: "14px 0 6px" }} {...p} />,
          p:  ({ node, ...p }) => <p  style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--c-fg)", margin: "0 0 10px" }} {...p} />,
          ul: ({ node, ...p }) => <ul style={{ paddingLeft: 22, margin: "8px 0", color: "var(--c-fg)", fontSize: 13.5, lineHeight: 1.6 }} {...p} />,
          ol: ({ node, ...p }) => <ol style={{ paddingLeft: 22, margin: "8px 0", color: "var(--c-fg)", fontSize: 13.5, lineHeight: 1.6 }} {...p} />,
          li: ({ node, ...p }) => <li style={{ margin: "2px 0" }} {...p} />,
          a:  ({ node, ...p }) => <a className="celiums-link" target="_blank" rel="noreferrer" {...p} />,
          code: ({ node, inline, className, children, ...p }) => {
            if (inline) {
              return (
                <code style={{
                  fontFamily: "var(--font-mono)", fontSize: "0.9em",
                  background: "var(--c-surface-2)", padding: "1px 5px",
                  borderRadius: 4, color: "var(--c-fg)",
                }} {...p}>{children}</code>
              );
            }
            return (
              <pre style={{
                background: "var(--c-surface-2)", border: "1px solid var(--c-divider)",
                borderRadius: 6, padding: "10px 12px", margin: "8px 0",
                fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.55,
                color: "var(--c-fg)", overflowX: "auto",
              }}>
                <code className={className} {...p}>{children}</code>
              </pre>
            );
          },
          blockquote: ({ node, ...p }) => <blockquote style={{
            borderLeft: "3px solid var(--c-green)", paddingLeft: 12, margin: "10px 0",
            color: "var(--c-fg-muted)", fontStyle: "italic",
          }} {...p} />,
          table: ({ node, ...p }) => <table style={{
            borderCollapse: "collapse", width: "100%", margin: "10px 0",
            fontSize: 13, border: "1px solid var(--c-border)",
            borderRadius: 6, overflow: "hidden",
          }} {...p} />,
          th: ({ node, ...p }) => <th style={{
            textAlign: "left", padding: "8px 10px", background: "var(--c-surface-2)",
            borderBottom: "1px solid var(--c-divider)", fontWeight: 500,
            color: "var(--c-fg)",
          }} {...p} />,
          td: ({ node, ...p }) => <td style={{
            padding: "8px 10px", borderBottom: "1px solid var(--c-divider)",
            color: "var(--c-fg)",
          }} {...p} />,
          hr: ({ node, ...p }) => <hr style={{
            border: 0, borderTop: "1px solid var(--c-divider)", margin: "16px 0",
          }} {...p} />,
        }}
      >
        {text || ""}
      </_ReactMarkdown>
    </div>
  );
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
