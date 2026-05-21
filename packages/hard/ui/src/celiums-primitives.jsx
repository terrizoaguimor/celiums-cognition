import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
// Shared primitives — logo, icons, Console shell (sidebar + topbar).
// All components consume CSS variables from tokens.css.

// ─── Logo ─────────────────────────────────────────────────────
export function CeliumsMark({ size = 22, glow = false }) {
  // Real brand mark: solid signal-green disc.
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ flex: '0 0 auto', display: 'block' }}>
      {glow && (
        <>
          <defs>
            <radialGradient id={`cm-glow-${size}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00D26A" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#00D26A" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="11" cy="11" r="10.5" fill={`url(#cm-glow-${size})`} />
        </>
      )}
      <circle cx="11" cy="11" r={size > 28 ? 5 : 4.4} fill="#00D26A" />
    </svg>
  );
}

export function CeliumsWordmark({ size = 22, glow = false }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 9, color: 'var(--c-fg)',
      fontFamily: "'Roboto Slab', Georgia, serif", letterSpacing: '-0.028em',
    }}>
      <CeliumsMark size={size} glow={glow} />
      <span style={{
        fontWeight: 500,
        fontSize: size * 1.05,
        lineHeight: 1,
        position: 'relative',
        top: 0,
      }}>
        Celiums
      </span>
    </span>
  );
}

// ─── Icons (inline, 16x16 by default, currentColor stroke) ────
export const Ico = {
  chat:     (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M2.5 6.5c0-2.2 1.8-4 4-4h3c2.2 0 4 1.8 4 4v2c0 2.2-1.8 4-4 4H7l-3 2.5v-2.6c-.9-.7-1.5-1.8-1.5-3z" strokeLinejoin="round"/></svg>,
  research: (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5" strokeLinecap="round"/></svg>,
  write:    (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" strokeLinejoin="round"/></svg>,
  mcp:      (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><rect x="2.5" y="2.5" width="4" height="4" rx=".5"/><rect x="9.5" y="2.5" width="4" height="4" rx=".5"/><rect x="2.5" y="9.5" width="4" height="4" rx=".5"/><path d="M6.5 4.5h3M4.5 6.5v3M11.5 6.5v6m-2-3h4" strokeLinecap="round"/></svg>,
  memory:   (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M3 5.5c0-1.4 1.1-2.5 2.5-2.5S8 4.1 8 5.5 8 8 8 8s0 1.1 0 2.5S6.9 13 5.5 13 3 11.9 3 10.5s.5-2 1.5-2-1.5 0-1.5-3z"/><path d="M13 5.5c0-1.4-1.1-2.5-2.5-2.5S8 4.1 8 5.5"/></svg>,
  settings: (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v1.7M8 12.8v1.7M2.6 4.5l1.5.85M11.9 10.65l1.5.85M1.5 8h1.7M12.8 8h1.7M2.6 11.5l1.5-.85M11.9 5.35l1.5-.85"/></svg>,
  billing:  (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M1.5 6.5h13"/></svg>,
  usage:    (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M2 13.5h12M3.5 13V9M6.5 13V6M9.5 13v-3M12.5 13V4"/></svg>,
  team:     (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><circle cx="6" cy="6" r="2.5"/><path d="M1.5 13c.5-2.2 2.3-3.5 4.5-3.5s4 1.3 4.5 3.5"/><circle cx="11.5" cy="5" r="1.8"/><path d="M10 8.6c1-.6 1.7-.6 1.5-.6 2 0 3.4 1.2 3.8 3"/></svg>,
  search:   (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14" strokeLinecap="round"/></svg>,
  plus:     (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}><path d="M8 3v10M3 8h10" strokeLinecap="round"/></svg>,
  copy:     (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><rect x="4.5" y="4.5" width="9" height="9" rx="1.5"/><path d="M11 4.5V3a1 1 0 00-1-1H3.5a1 1 0 00-1 1v6.5a1 1 0 001 1H5"/></svg>,
  check:    (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><path d="M3 8.5L6.5 12l7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  download: (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M8 2v8M4.5 7l3.5 3.5L11.5 7M2.5 13.5h11" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  external: (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M9 2.5h4.5V7M13 3L7.5 8.5M12 9v3.5a1 1 0 01-1 1H3.5a1 1 0 01-1-1V5a1 1 0 011-1H7" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  warn:     (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M8 2l6.5 11.5h-13L8 2z" strokeLinejoin="round"/><path d="M8 7v3M8 12.2v.1" strokeLinecap="round"/></svg>,
  info:     (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><circle cx="8" cy="8" r="6"/><path d="M8 7.5v4M8 5.3v.1" strokeLinecap="round"/></svg>,
  chevDown: (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  arrowR:   (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}><path d="M3.5 8h9M9 4.5L12.5 8 9 11.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  dots:     (p) => <svg viewBox="0 0 16 16" fill="currentColor" {...p}><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>,
  x:        (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round"/></svg>,
  card:     (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9.5h19"/></svg>,
  eye:      (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>,
  eyeOff:   (p) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M2 2l12 12M6.5 6.5a2 2 0 002.8 2.8M4 4.5C2.5 5.5 1 8 1 8s2.5 4.5 7 4.5c1.3 0 2.5-.3 3.5-.8M9 3.6c4.3.7 6 4.4 6 4.4s-.6 1.1-1.8 2.1" strokeLinecap="round"/></svg>,
};

// ─── Avatar ───────────────────────────────────────────────────
export function Avatar({ name, color, size = 28 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const palette = ['#7fb27a', '#c5a572', '#8a9bb4', '#b88a8a', '#a8a07a', '#9a8ab8'];
  const bg = color || palette[(name || '').charCodeAt(0) % palette.length];
  return (
    <span className="celiums-avatar" style={{
      width: size, height: size, fontSize: size * 0.4,
      background: bg, color: 'oklch(0.99 0 0)', border: 0,
    }}>{initials}</span>
  );
}

// ─── Console shell ────────────────────────────────────────────
// Sidebar + topbar + content well. Used by every in-app screen.
// `banner` prop renders a slim row above the content (trial banner).
export function ConsoleShell({
  theme = 'light',
  active = 'chat',
  workspace = 'Workspace',
  workspaceMeta = 'Solo',
  user = { name: 'Maren Ito', email: 'maren@acme.co' },
  banner = null,
  children,
  width = 1440,
  height = 900,
}) {
  const navTop = [
    { id: 'chat',     label: 'Chat',     icon: Ico.chat,     hint: '⌘1' },
    { id: 'research', label: 'Research', icon: Ico.research, hint: '⌘2' },
    { id: 'write',    label: 'Write',    icon: Ico.write,    hint: '⌘3' },
    { id: 'mcp',      label: 'MCP',      icon: Ico.mcp,      hint: '⌘4' },
    { id: 'memory',   label: 'Memory',   icon: Ico.memory,   hint: '⌘5' },
  ];
  const navBottom = [
    { id: 'usage',    label: 'Usage',    icon: Ico.usage    },
    { id: 'team',     label: 'Team',     icon: Ico.team     },
    { id: 'billing',  label: 'Billing',  icon: Ico.billing  },
    { id: 'settings', label: 'Settings', icon: Ico.settings },
  ];

  return (
    <div className="celiums" data-theme={theme} style={{
      width, height, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Topbar */}
      <div style={{
        height: 48, flex: '0 0 48px',
        borderBottom: '1px solid var(--c-border)',
        background: 'var(--c-bg)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
      }}>
        <CeliumsWordmark size={18} />
        <span style={{ color: 'var(--c-fg-faint)', fontSize: 14 }}>/</span>
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'transparent', border: 0, cursor: 'pointer',
          padding: '4px 8px', borderRadius: 6,
          color: 'var(--c-fg)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
        }}>
          {workspace}
          <span style={{ color: 'var(--c-fg-subtle)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            {workspaceMeta}
          </span>
          <Ico.chevDown width={11} height={11} style={{ opacity: .5 }} />
        </button>

        <div style={{ flex: 1 }} />

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 10px', borderRadius: 6,
          border: '1px solid var(--c-border)',
          background: 'var(--c-surface)',
          fontSize: 12, color: 'var(--c-fg-subtle)',
          width: 220,
        }}>
          <Ico.search width={13} height={13} />
          <span>Search or jump to…</span>
          <span style={{ flex: 1 }} />
          <span className="celiums-kbd" style={{ borderBottomWidth: 1 }}>⌘K</span>
        </div>

        <Avatar name={user.name} size={26} />
      </div>

      {/* Trial / system banner */}
      {banner}

      {/* Body: sidebar + content */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{
          width: 220, flex: '0 0 220px',
          borderRight: '1px solid var(--c-border)',
          background: 'var(--c-surface-2)',
          display: 'flex', flexDirection: 'column',
          padding: '14px 10px',
        }}>
          {navTop.map(n => <SidebarRow key={n.id} {...n} active={active === n.id} />)}
          <div style={{ flex: 1 }} />
          <div style={{ height: 1, background: 'var(--c-divider)', margin: '8px 6px 8px' }} />
          {navBottom.map(n => <SidebarRow key={n.id} {...n} active={active === n.id} />)}

          <div style={{ height: 1, background: 'var(--c-divider)', margin: '8px 6px 6px' }} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 8px',
          }}>
            <Avatar name={user.name} size={26} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--c-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
              <div style={{ fontSize: 11, color: 'var(--c-fg-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
            </div>
          </div>
        </div>

        {/* Content well */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', background: 'var(--c-bg)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function SidebarRow({ icon: Icon, label, hint, active }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px',
      borderRadius: 6,
      cursor: 'pointer',
      background: active ? 'var(--c-active)' : 'transparent',
      color: active ? 'var(--c-fg)' : 'var(--c-fg-muted)',
      fontSize: 13, fontWeight: active ? 500 : 400,
      marginBottom: 1,
    }}>
      <Icon width={15} height={15} />
      <span>{label}</span>
      {hint && (
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--c-fg-faint)', fontFamily: 'var(--font-mono)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

// ─── Trial banner ─────────────────────────────────────────────
// States: 'calm' (14-4 days), 'amber' (3-1 days), 'last' (last day),
//          'free' (post-trial degraded), 'failed' (payment failed)
export function TrialBanner({ state = 'calm', daysLeft = 11 }) {
  const variants = {
    calm: {
      bg: 'var(--c-surface-2)', border: 'var(--c-divider)',
      dot: <span className="celiums-dot" />,
      text: <><strong style={{ color: 'var(--c-fg)', fontWeight: 500 }}>Trial</strong>
        <span style={{ color: 'var(--c-fg-muted)' }}> · {daysLeft} days left</span></>,
      cta: 'Manage billing',
    },
    amber: {
      bg: 'var(--c-amber-soft)', border: 'transparent',
      dot: <span className="celiums-dot amber" />,
      text: <><strong style={{ color: 'var(--c-amber-text)', fontWeight: 500 }}>Trial ending</strong>
        <span style={{ color: 'var(--c-amber-text)', opacity: .8 }}> · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left.</span>
        <span style={{ color: 'var(--c-amber-text)', opacity: .7 }}> Card on file will be charged $XX on May 29.</span></>,
      cta: 'Review plan',
    },
    last: {
      bg: 'var(--c-amber-soft)', border: 'transparent',
      dot: <span className="celiums-dot amber" />,
      text: <><strong style={{ color: 'var(--c-amber-text)', fontWeight: 500 }}>Last day of trial</strong>
        <span style={{ color: 'var(--c-amber-text)', opacity: .8 }}> · You'll be charged $XX tomorrow unless you cancel.</span></>,
      cta: 'Review plan',
    },
    free: {
      bg: 'var(--c-surface-2)', border: 'var(--c-border)',
      dot: <span className="celiums-dot muted" />,
      text: <><strong style={{ color: 'var(--c-fg)', fontWeight: 500 }}>Free plan</strong>
        <span style={{ color: 'var(--c-fg-muted)' }}> · Hosted tools paused. Local memory and journal still work.</span></>,
      cta: 'Resume with a plan',
    },
    failed: {
      bg: 'var(--c-red-soft)', border: 'transparent',
      dot: <span className="celiums-dot red" />,
      text: <><strong style={{ color: 'var(--c-red-text)', fontWeight: 500 }}>Payment failed</strong>
        <span style={{ color: 'var(--c-red-text)', opacity: .85 }}> · We couldn't charge your card ending 4242. Update to keep using hosted tools.</span></>,
      cta: 'Update card',
    },
  };
  const v = variants[state];
  return (
    <div style={{
      flex: '0 0 auto',
      height: 36,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 16px',
      background: v.bg,
      borderBottom: `1px solid ${v.border}`,
      fontSize: 12.5,
    }}>
      {v.dot}
      <span>{v.text}</span>
      <span style={{ flex: 1 }} />
      <button style={{
        border: 0, background: 'transparent', cursor: 'pointer',
        fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit',
        color: state === 'failed' ? 'var(--c-red-text)'
          : (state === 'amber' || state === 'last') ? 'var(--c-amber-text)'
          : 'var(--c-fg)',
        textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'currentColor',
        textDecorationStyle: 'solid', padding: 0,
      }}>{v.cta}</button>
      {state !== 'free' && state !== 'failed' && (
        <button style={{
          border: 0, background: 'transparent', cursor: 'pointer',
          width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--c-fg-muted)', borderRadius: 4,
        }}><Ico.x width={11} height={11} /></button>
      )}
    </div>
  );
}

// ─── PreAuth shell: full-bleed background + brand mark in corner ───
export function PreAuthShell({ theme = 'light', children, width = 1280, height = 800, onToggleTheme }) {
  const isDark = theme === 'dark';
  return (
    <div className="celiums" data-theme={theme} style={{
      width, height, display: 'flex', flexDirection: 'column',
      background: 'var(--c-bg)', overflow: 'hidden', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: 24, left: 28, zIndex: 2,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <CeliumsWordmark size={20} />
      </div>
      <div style={{
        position: 'absolute', top: 24, right: 28, zIndex: 2,
        display: 'flex', alignItems: 'center', gap: 14,
        fontSize: 13, color: 'var(--c-fg-muted)',
      }}>
        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Light mode" : "Dark mode"}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30,
              background: 'transparent',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              color: 'var(--c-fg-muted)',
              cursor: 'pointer',
              fontSize: 14,
              padding: 0,
            }}>
            {isDark ? '☀' : '☾'}
          </button>
        )}
        {children._sideLink}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 40px' }}>
        {children.main || children}
      </div>
    </div>
  );
}

// Helper: code/snippet block
export function Snippet({ title, code, lines }) {
  return (
    <div style={{
      border: '1px solid var(--c-border)',
      borderRadius: 8,
      background: 'var(--c-surface-2)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid var(--c-divider)',
        fontSize: 11.5, fontFamily: 'var(--font-mono)',
        color: 'var(--c-fg-muted)',
      }}>
        <span>{title}</span>
        <span style={{ flex: 1 }} />
        <button className="celiums-btn ghost sm" style={{ padding: '3px 7px' }}>
          <Ico.copy width={11} height={11} /> Copy
        </button>
      </div>
      <pre style={{
        margin: 0, padding: '12px 14px',
        fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.55,
        color: 'var(--c-fg)', whiteSpace: 'pre', overflow: 'auto',
      }}>{code || lines.join('\n')}</pre>
    </div>
  );
}

// Inline tab / pill picker
export function TabPicker({ tabs, active }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--c-border)' }}>
      {tabs.map(t => (
        <button key={t} style={{
          border: 0, background: 'transparent', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 13,
          padding: '10px 14px',
          color: t === active ? 'var(--c-fg)' : 'var(--c-fg-muted)',
          fontWeight: t === active ? 500 : 400,
          borderBottom: t === active ? '2px solid var(--c-green)' : '2px solid transparent',
          marginBottom: -1,
        }}>{t}</button>
      ))}
    </div>
  );
}

// Section header within content well
export function ScreenHeader({ title, eyebrow, actions, description }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && <div className="celiums-eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>}
        <h1 className="celiums-h2" style={{ marginBottom: description ? 6 : 0 }}>{title}</h1>
        {description && <div style={{ fontSize: 13.5, color: 'var(--c-fg-muted)', maxWidth: 640 }}>{description}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>{actions}</div>}
    </div>
  );
}

// Wrapper for screen content — gives the right padding inside the shell
export function ScreenWell({ children, maxWidth = 920, padding = '32px 40px' }) {
  return (
    <div style={{ height: '100%', overflow: 'hidden', padding }}>
      <div style={{ maxWidth, margin: '0 auto', height: '100%' }}>{children}</div>
    </div>
  );
}

Object.assign(window, {
  CeliumsMark, CeliumsWordmark, Ico, Avatar,
  ConsoleShell, TrialBanner, PreAuthShell,
  Snippet, TabPicker, ScreenHeader, ScreenWell,
});
