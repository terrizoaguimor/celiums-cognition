import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
import { MOCK_COUNTS, MOCK_HEALTH } from './data.js';
import { CCConsoleShell, Toast } from './cc-shell.jsx';
import { TweakRadio, TweakSection, TweakToggle, TweaksPanel } from './tweaks-panel.jsx';
import { AuthFlow } from './auth.jsx';
import { Overview } from './overview.jsx';
import { Skills } from './skills.jsx';
import { Memories } from './memories.jsx';
import { Journal } from './journal.jsx';
import { Ethics } from './ethics.jsx';
import { Settings } from './settings.jsx';
/* Celiums Cognition — App shell + routing + Tweaks. */

export const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "showLiveDot": true
}/*EDITMODE-END*/;

export const ROUTES = ["overview", "skills", "memories", "journal", "ethics", "settings"];

export function App() {
  // First-run / session detection
  const [authState, setAuthState] = useState(() => {
    try {
      const hasAccount = !!localStorage.getItem("celiums.account");
      const hasSession = !!localStorage.getItem("celiums.session");
      if (!hasAccount) return "onboard";
      if (!hasSession) return "login";
      return "in";
    } catch { return "onboard"; }
  });

  const [route, setRoute] = useState(() => {
    const h = window.location.hash.replace("#", "");
    return ROUTES.includes(h) ? h : "overview";
  });
  const [values, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [toast, setToast] = useState({ open: false, msg: "" });

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace("#", "");
      if (ROUTES.includes(h)) setRoute(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Apply theme to documentElement so :root[data-theme="dark"] vars cascade
  // to portal-rendered elements (toast, tweak panel, body bg).
  useEffect(() => {
    if (values.theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }, [values.theme]);

  // Keyboard shortcuts ⌘1-5, ⌘,
  useEffect(() => {
    const onKey = e => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const map = { "1": "overview", "2": "skills", "3": "memories", "4": "journal", "5": "ethics", ",": "settings" };
      const target = map[e.key];
      if (target) { e.preventDefault(); navigate(target); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const navigate = (r) => {
    setRoute(r);
    window.location.hash = r;
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "instant" });
  };

  const showToast = msg => {
    setToast({ open: true, msg });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast(t => ({ ...t, open: false })), 1900);
  };

  const health = MOCK_DATA.MOCK_HEALTH;
  const counts = MOCK_DATA.MOCK_COUNTS;
  const allOk = Object.values(health.stack).every(s => s.ok);
  const healthForShell = { ...health, allOk };

  // Read account for shell display
  const account = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("celiums.account") || "{}"); }
    catch { return {}; }
  }, [authState]);
  const user = { name: account.username || "Operator", email: account.email || "—" };

  useEffect(() => {
    if (authState !== "in") {
      document.title = authState === "onboard" ? "Get started · Celiums Cognition" : "Sign in · Celiums Cognition";
      return;
    }
    const titles = {
      overview: "Overview", skills: "Skills", memories: "Memories",
      journal: "Journal", ethics: "Ethics", settings: "Settings"
    };
    document.title = `${titles[route]} · Celiums Cognition`;
  }, [route, authState]);

  if (authState !== "in") {
    return (
      <>
        <AuthFlow
          mode={authState}
          theme={values.theme}
          onComplete={(res) => {
            if (res?.existing && authState === "onboard") setAuthState("login");
            else setAuthState("in");
          }}
        />
        <TweaksMount values={values} setTweak={setTweak} />
      </>
    );
  }

  return (
    <>
      <CCConsoleShell
        route={route}
        onNavigate={navigate}
        counts={counts}
        health={healthForShell}
        theme={values.theme}
        user={user}
      >
        {route === "overview" && <Overview health={health} counts={counts} showToast={showToast} />}
        {route === "skills"   && <Skills showToast={showToast} />}
        {route === "memories" && <Memories showToast={showToast} />}
        {route === "journal"  && <Journal showToast={showToast} />}
        {route === "ethics"   && <Ethics showToast={showToast} />}
        {route === "settings" && <Settings showToast={showToast} />}
      </CCConsoleShell>

      <Toast open={toast.open} message={toast.msg} />

      <TweaksMount values={values} setTweak={setTweak} />
    </>
  );
}

export function TweaksMount({ values, setTweak }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme">
        <TweakRadio
          label="Mode"
          value={values.theme}
          options={["light", "dark"]}
          onChange={v => setTweak("theme", v)}
        />
      </TweakSection>
      <TweakSection label="Live polling">
        <TweakToggle label="Pulse status dot" value={values.showLiveDot} onChange={v => setTweak("showLiveDot", v)} />
      </TweakSection>
      <TweakSection label="Demo">
        <button className="celiums-btn sm" style={{ width: "100%" }} onClick={() => {
          localStorage.clear();
          window.location.reload();
        }}>↻ Reset · re-run onboarding</button>
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
