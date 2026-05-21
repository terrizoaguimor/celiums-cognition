/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ico } from "./celiums-primitives.jsx";
import { fetchSkills } from "./data.js";

/* Command palette — ⌘K / Ctrl+K modal that exposes:
 *   • the actions the topbar/avatar hide (sign out, theme toggle, …)
 *   • a live search against /skills (debounced, fires on first keystroke
 *     so the user gets results without pressing Enter)
 *
 * Keyboard:
 *   ↑/↓ to move, Enter to execute, Esc to close, / for instant focus on
 *   the input when nothing else is focused (global handler lives in App).
 */

const DEBOUNCE_MS = 220;
const MAX_SKILL_RESULTS = 8;

export function CommandPalette({
  open, onClose,
  onNavigate, onLogout, onToggleTheme,
  onOpenSkill, theme,
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  // Reset on every open
  useEffect(() => {
    if (open) {
      setQ("");
      setDebouncedQ("");
      setSkills([]);
      setActiveIdx(0);
      // Focus after the modal mounts
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounce the query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Live skill search
  useEffect(() => {
    if (!open || debouncedQ.length === 0) {
      setSkills([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    fetchSkills({ q: debouncedQ, limit: MAX_SKILL_RESULTS })
      .then((r) => {
        if (cancelled) return;
        setSkills(r?.skills ?? []);
      })
      .catch(() => { if (!cancelled) setSkills([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, debouncedQ]);

  // Build the unified item list (actions first, then skill results)
  const actions = useMemo(() => {
    const all = [
      { id: "go:overview", group: "Navigate", label: "Overview",  hint: "⌘1", run: () => onNavigate?.("overview") },
      { id: "go:skills",   group: "Navigate", label: "Skills",    hint: "⌘2", run: () => onNavigate?.("skills") },
      { id: "go:memories", group: "Navigate", label: "Memories",  hint: "⌘3", run: () => onNavigate?.("memories") },
      { id: "go:journal",  group: "Navigate", label: "Journal",   hint: "⌘4", run: () => onNavigate?.("journal") },
      { id: "go:ethics",   group: "Navigate", label: "Ethics",    hint: "⌘5", run: () => onNavigate?.("ethics") },
      { id: "go:settings", group: "Navigate", label: "Settings",  hint: "⌘,", run: () => onNavigate?.("settings") },
      { id: "theme",       group: "Account",  label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode", run: () => onToggleTheme?.() },
      { id: "logout",      group: "Account",  label: "Sign out", danger: true, run: () => onLogout?.() },
    ];
    if (!q.trim()) return all;
    const needle = q.toLowerCase();
    return all.filter((a) => a.label.toLowerCase().includes(needle));
  }, [q, theme, onNavigate, onToggleTheme, onLogout]);

  const skillItems = skills.map((s) => ({
    id: `skill:${s.name}`,
    group: "Skills",
    label: s.display_name ?? s.name,
    sub: s.description ? String(s.description).slice(0, 80) + (s.description.length > 80 ? "…" : "") : null,
    chip: s.pillar,
    run: () => onOpenSkill?.(s.name),
  }));

  const items = [...actions, ...skillItems];

  // Clamp active index when items change
  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(Math.max(0, items.length - 1));
  }, [items.length, activeIdx]);

  // Keyboard nav on the modal
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(items.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIdx];
      if (!item) return;
      item.run();
      onClose();
      return;
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(10,12,11,0.45)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "12vh",
        backdropFilter: "blur(2px)",
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="celiums"
        data-theme={theme}
        style={{
          width: "min(640px, 92vw)",
          background: "var(--c-glass-strong)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
          border: "1px solid transparent",
          borderImage: "var(--celiums-grad-strong) 1",
          borderRadius: 14,
          boxShadow: "0 28px 72px rgba(0,0,0,0.28)",
          overflow: "hidden",
          fontFamily: "var(--font-sans)",
          color: "var(--c-fg)",
        }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 16px",
          borderBottom: "1px solid var(--c-divider)",
        }}>
          <Ico.search width={15} height={15} />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }}
            placeholder="Type a command, or search skills…"
            style={{
              flex: 1, border: 0, outline: "none", background: "transparent",
              fontSize: 14, color: "var(--c-fg)", fontFamily: "inherit",
            }}
          />
          {loading && <div className="spin" />}
          <span className="celiums-kbd" style={{ fontSize: 10 }}>esc</span>
        </div>

        <div style={{ maxHeight: "52vh", overflowY: "auto", padding: "6px 0" }}>
          {items.length === 0 && (
            <div style={{ padding: "24px 16px", color: "var(--c-fg-subtle)", fontSize: 13 }}>
              No matches. Try a different keyword, or press <span className="celiums-kbd" style={{ fontSize: 10 }}>esc</span>.
            </div>
          )}
          {renderGrouped(items, activeIdx, setActiveIdx, onClose)}
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "8px 14px",
          borderTop: "1px solid var(--c-divider)",
          fontSize: 11, color: "var(--c-fg-subtle)",
          fontFamily: "var(--font-mono)",
        }}>
          <span><span className="celiums-kbd" style={{ fontSize: 10 }}>↑↓</span> move</span>
          <span><span className="celiums-kbd" style={{ fontSize: 10 }}>↵</span> select</span>
          <span><span className="celiums-kbd" style={{ fontSize: 10 }}>esc</span> close</span>
          <span style={{ flex: 1 }} />
          <span>{items.length} {items.length === 1 ? "item" : "items"}</span>
        </div>
      </div>
    </div>
  );
}

function renderGrouped(items, activeIdx, setActiveIdx, onClose) {
  // Group items by .group but preserve the global index so arrow nav
  // matches the visual order.
  const groups = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const last = groups[groups.length - 1];
    if (!last || last.group !== it.group) groups.push({ group: it.group, items: [{ ...it, idx: i }] });
    else last.items.push({ ...it, idx: i });
  }
  return groups.map((g) => (
    <div key={g.group} style={{ padding: "4px 0" }}>
      <div style={{
        padding: "4px 16px", fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase",
        color: "var(--c-fg-subtle)", fontFamily: "var(--font-mono)",
      }}>
        {g.group}
      </div>
      {g.items.map((it) => (
        <button
          key={it.id}
          type="button"
          onMouseEnter={() => setActiveIdx(it.idx)}
          onClick={() => { it.run(); onClose(); }}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            width: "100%", padding: "9px 16px",
            background: it.idx === activeIdx ? "var(--c-hover)" : "transparent",
            border: 0, cursor: "pointer", textAlign: "left",
            color: it.danger ? "var(--c-red-text)" : "var(--c-fg)",
            fontFamily: "inherit", fontSize: 13,
          }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              {it.chip && <span className="celiums-chip" style={{ fontSize: 10 }}>{it.chip}</span>}
            </div>
            {it.sub && (
              <div style={{
                fontSize: 11.5, color: "var(--c-fg-subtle)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                marginTop: 2,
              }}>
                {it.sub}
              </div>
            )}
          </div>
          {it.hint && <span className="celiums-kbd" style={{ fontSize: 10 }}>{it.hint}</span>}
        </button>
      ))}
    </div>
  ));
}
