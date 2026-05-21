/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react"; // useRef used by usePageTransition
import { CCConsoleShell, Toast } from "./cc-shell.jsx";
import { TweakRadio, TweakSection, TweakToggle, TweaksPanel } from "./tweaks-panel.jsx";
import { CommandPalette } from "./command-palette.jsx";
import { AuthFlow } from "./auth.jsx";
import { Overview } from "./overview.jsx";
import { Skills } from "./skills.jsx";
import { Memories } from "./memories.jsx";
import { Journal } from "./journal.jsx";
import { Ethics } from "./ethics.jsx";
import { Settings } from "./settings.jsx";
import { Docs } from "./docs.jsx";
import { useLenis, usePageTransition } from "./motion.js";
import {
  authMe, authLogout,
  fetchHealth, fetchCounts, useQuery,
} from "./data.js";

/* App shell — bootstraps the session from /auth/me, routes tabs, holds
 * the lightweight Tweaks (theme / live-dot) in localStorage. */

export const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "showLiveDot": true,
}/*EDITMODE-END*/;

export const ROUTES = ["overview", "skills", "memories", "journal", "ethics", "docs", "settings"];

export function App() {
  // ── bootstrap auth ──
  // "bootstrapping" until /auth/me returns; then "onboard" | "login" | "in".
  const [authState, setAuthState] = useState("bootstrapping");
  const [user, setUser] = useState(null);

  const refreshAuth = useCallback(async () => {
    try {
      const r = await authMe();
      if (r.authenticated) {
        setUser(r.user);
        setAuthState("in");
      } else if (r.account_exists) {
        setUser(null);
        setAuthState("login");
      } else {
        setUser(null);
        setAuthState("onboard");
      }
    } catch {
      // /auth/me failed (network/server). Show login screen as the safest
      // state — onboarding would let someone overwrite the account.
      setUser(null);
      setAuthState("login");
    }
  }, []);
  useEffect(() => { refreshAuth(); }, [refreshAuth]);

  // ── tab routing via location.hash ──
  const [route, setRoute] = useState(() => {
    const h = window.location.hash.replace("#", "");
    return ROUTES.includes(h) ? h : "overview";
  });
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace("#", "");
      if (ROUTES.includes(h)) setRoute(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (r) => {
    setRoute(r);
    window.location.hash = r;
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "instant" });
  };

  // ── visual tweaks ──
  const [values, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useEffect(() => {
    if (values.theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }, [values.theme]);

  // ── command palette open state + ⌘K binding ──
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ── keyboard shortcuts ⌘1-5 + ⌘, + ⌘K + / ──
  useEffect(() => {
    const onKey = (e) => {
      // ⌘K / Ctrl+K → open palette (only when authenticated)
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        if (authState === "in") {
          e.preventDefault();
          setPaletteOpen(true);
        }
        return;
      }
      // ⌘/Ctrl + number → jump tabs
      if (!(e.metaKey || e.ctrlKey)) return;
      const map = { "1": "overview", "2": "skills", "3": "memories", "4": "journal", "5": "ethics", "6": "docs", ",": "settings" };
      const target = map[e.key];
      if (target) { e.preventDefault(); navigate(target); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── toast ──
  const [toast, setToast] = useState({ open: false, msg: "" });
  const showToast = (msg) => {
    setToast({ open: true, msg });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast((t) => ({ ...t, open: false })), 1900);
  };

  // ── live stack health + counts (only when authenticated) ──
  const enabled = authState === "in";
  const healthQ = useQuery(() => (enabled ? fetchHealth() : Promise.resolve(null)), [enabled]);
  const countsQ = useQuery(() => (enabled ? fetchCounts() : Promise.resolve(null)), [enabled]);
  const healthForShell = useMemo(() => {
    if (!healthQ.data) return null;
    const stack = healthQ.data.stack ?? {};
    const allOk = Object.values(stack).every((s) => s?.ok);
    return { ...healthQ.data, allOk };
  }, [healthQ.data]);

  // ── page title ──
  useEffect(() => {
    if (authState !== "in") {
      document.title = authState === "onboard"
        ? "Get started · Celiums Cognition"
        : authState === "login"
          ? "Sign in · Celiums Cognition"
          : "Celiums Cognition";
      return;
    }
    const titles = {
      overview: "Overview", skills: "Skills", memories: "Memories",
      journal: "Journal", ethics: "Ethics", docs: "Docs", settings: "Settings",
    };
    document.title = `${titles[route]} · Celiums Cognition`;
  }, [route, authState]);

  // ── motion (hooks MUST run on every render — keep above any
  //     conditional early-return; React's rules-of-hooks tripwire) ──
  // Lenis disabled by default — it fought the <main>/<div ref>
  // structure under flex on certain browsers and produced a no-scroll
  // pathology. Pass null to keep the hook call slot stable without
  // mounting the instance. Native scroll is acceptable; reintroduce
  // Lenis later if/when we move to a sticky-header layout that suits it.
  useLenis(null);
  const routeRef = useRef(null);
  usePageTransition(routeRef, [route, authState]);

  // ── render ──

  if (authState === "bootstrapping") {
    return <Bootstrapping theme={values.theme} />;
  }

  if (authState !== "in") {
    return (
      <>
        <AuthFlow
          mode={authState}
          theme={values.theme}
          onToggleTheme={() => setTweak("theme", values.theme === "dark" ? "light" : "dark")}
          onComplete={(res) => {
            // res may carry { existing, wantOnboard }; either way, re-check
            // the server to derive the new state.
            if (res?.wantOnboard) { setAuthState("onboard"); return; }
            refreshAuth();
          }}
        />
        <TweaksMount values={values} setTweak={setTweak} />
      </>
    );
  }

  const shellUser = {
    name: user?.username || "Operator",
    email: user?.email || "—",
  };

  const doLogout = async () => {
    try { await authLogout(); } catch {}
    await refreshAuth();
  };
  const toggleTheme = () => setTweak("theme", values.theme === "dark" ? "light" : "dark");

  return (
    <>
      <CCConsoleShell
        route={route}
        onNavigate={navigate}
        counts={countsQ.data}
        health={healthForShell}
        theme={values.theme}
        user={shellUser}
        onLogout={doLogout}
        onOpenPalette={() => setPaletteOpen(true)}
        onToggleTheme={toggleTheme}
        routeRef={routeRef}
      >
        {route === "overview" && <Overview showToast={showToast} />}
        {route === "skills"   && <Skills   showToast={showToast} />}
        {route === "memories" && <Memories showToast={showToast} />}
        {route === "journal"  && <Journal  showToast={showToast} />}
        {route === "ethics"   && <Ethics   showToast={showToast} />}
        {route === "docs"     && <Docs />}
        {route === "settings" && <Settings showToast={showToast} user={user} />}
      </CCConsoleShell>

      <Toast open={toast.open} message={toast.msg} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        theme={values.theme}
        onNavigate={navigate}
        onLogout={doLogout}
        onToggleTheme={toggleTheme}
        onOpenSkill={(name) => { navigate("skills"); window.location.hash = `skills?open=${encodeURIComponent(name)}`; }}
      />

      <TweaksMount values={values} setTweak={setTweak} />
    </>
  );
}

function Bootstrapping({ theme }) {
  // Bare splash while /auth/me is in flight. Theme respected so we don't
  // flash light-on-dark.
  const isDark = theme === "dark";
  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: isDark ? "#0b0d10" : "#ffffff",
      color: isDark ? "#9ca3af" : "#6b7280",
      fontSize: 13, fontFamily: "var(--font-mono)",
    }}>
      Celiums Cognition · loading…
    </div>
  );
}

function useTweaks(defaults) {
  const [values, setValues] = useState(() => {
    try {
      const raw = localStorage.getItem("celiums.tweaks");
      if (!raw) return defaults;
      return { ...defaults, ...JSON.parse(raw) };
    } catch { return defaults; }
  });
  const set = (k, v) => {
    setValues((prev) => {
      const next = { ...prev, [k]: v };
      try { localStorage.setItem("celiums.tweaks", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  return [values, set];
}

export function TweaksMount({ values, setTweak }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme">
        <TweakRadio
          label="Mode"
          value={values.theme}
          options={["light", "dark"]}
          onChange={(v) => setTweak("theme", v)}
        />
      </TweakSection>
      <TweakSection label="Live polling">
        <TweakToggle label="Pulse status dot" value={values.showLiveDot} onChange={(v) => setTweak("showLiveDot", v)} />
      </TweakSection>
      <TweakSection label="Demo">
        <button className="celiums-btn sm" style={{ width: "100%" }} onClick={async () => {
          try { await authLogout(); } catch {}
          localStorage.clear();
          window.location.reload();
        }}>↻ Sign out + reset</button>
      </TweakSection>
    </TweaksPanel>
  );
}
