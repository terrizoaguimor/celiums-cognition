/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useEffect, useState, useMemo } from "react";
import { PageHead, SectionCard, MarkdownView } from "./cc-shell.jsx";

// Vite's `?raw` query loads the file as a string at build time — no
// runtime fetch needed. Each doc is bundled into the SPA.
import overviewMd     from "./docs/overview.md?raw";
import memoryMd       from "./docs/memory.md?raw";
import journalMd      from "./docs/journal.md?raw";
import ethicsMd       from "./docs/ethics.md?raw";
import skillsMd       from "./docs/skills.md?raw";
import circadianMd    from "./docs/circadian.md?raw";
import agentsMd       from "./docs/agents.md?raw";
import failureModesMd from "./docs/failure-modes.md?raw";

const PAGES = [
  { id: "overview",       label: "Overview",          icon: "◐", md: overviewMd },
  { id: "memory",         label: "Memory",            icon: "◉", md: memoryMd },
  { id: "journal",        label: "Journal",           icon: "≡", md: journalMd },
  { id: "ethics",         label: "Ethics",            icon: "⚖", md: ethicsMd },
  { id: "skills",         label: "Skills",            icon: "✦", md: skillsMd },
  { id: "circadian",      label: "Circadian",         icon: "☼", md: circadianMd },
  { id: "agents",         label: "Agents & subagents", icon: "⛂", md: agentsMd },
  { id: "failure-modes",  label: "Failure modes",     icon: "⚠", md: failureModesMd },
];

/* Tiny hash-router for the docs sub-route.  URL shape: #docs?p=<id>
 * (compatible with the App's existing hashchange handler — `docs` is
 * registered in ROUTES, the ?p= is page-internal). */
function readDocPage() {
  try {
    const hash = window.location.hash || "";
    const m = hash.match(/[?&]p=([^&]+)/);
    if (m) {
      const v = decodeURIComponent(m[1]);
      if (PAGES.some((p) => p.id === v)) return v;
    }
  } catch { /* fall through */ }
  return "overview";
}

function writeDocPage(id) {
  // Preserve the `docs` route prefix; only swap the `p=` value.
  try {
    const cur = window.location.hash || "";
    const stripped = cur.replace(/^#?/, "").replace(/[?&]p=[^&]*/g, "").replace(/[?&]$/, "");
    const base = stripped || "docs";
    window.location.hash = `${base}?p=${encodeURIComponent(id)}`;
  } catch { /* ignore */ }
}

export function Docs() {
  const [active, setActive] = useState(() => readDocPage());

  useEffect(() => {
    const onHash = () => setActive(readDocPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const page = useMemo(() => PAGES.find((p) => p.id === active) ?? PAGES[0], [active]);

  return (
    <>
      <PageHead
        eyebrow="Documentation"
        title={page.label}
        sub={<>Operator-facing reference. All concepts the plugin exposes, written down once. Click any topic in the sidebar.</>}
        actions={
          <>
            <span className="celiums-chip">{PAGES.length} topics</span>
          </>
        }
      />

      <div className="cc-docs-layout">
        <aside className="cc-docs-nav">
          <SectionCard title="Topics" count={`${PAGES.length}`}>
            <div style={{ padding: "6px 0" }}>
              {PAGES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setActive(p.id); writeDocPage(p.id); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", padding: "9px 14px", border: 0,
                    background: active === p.id ? "var(--c-hover)" : "transparent",
                    cursor: "pointer", textAlign: "left",
                    fontFamily: "inherit", fontSize: 13,
                    color: active === p.id ? "var(--c-fg)" : "var(--c-fg-muted)",
                    fontWeight: active === p.id ? 500 : 400,
                    borderLeft: `3px solid ${active === p.id ? "var(--c-green)" : "transparent"}`,
                    transition: "background 0.12s ease, border-color 0.12s ease, color 0.12s ease",
                  }}>
                  <span style={{ width: 16, textAlign: "center", color: "var(--c-fg-faint)" }}>{p.icon}</span>
                  <span style={{ flex: 1 }}>{p.label}</span>
                </button>
              ))}
            </div>
          </SectionCard>

          <div style={{
            marginTop: 14, padding: "10px 12px",
            fontSize: 11, color: "var(--c-fg-subtle)",
            fontFamily: "var(--font-mono)", lineHeight: 1.55,
          }}>
            Source lives in <code>packages/hard/ui/src/docs/*.md</code> — edit
            the file and rebuild to update the dashboard.
          </div>
        </aside>

        <div className="cc-docs-content">
          <SectionCard>
            <div style={{ padding: "20px 28px", maxWidth: 760 }}>
              <MarkdownView text={page.md} />
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
