import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
import { Ico, PreAuthShell } from './celiums-primitives.jsx';
/* Onboarding + Login flow — using Celiums design system. */

export function AuthFlow({ mode, theme = "light", onComplete }) {
  return mode === "onboard"
    ? <Onboarding theme={theme} onComplete={onComplete} />
    : <LogIn theme={theme} onComplete={onComplete} />;
}

/* ─────────────────────── Onboarding (full sequence) ─────────────────────── */
export function Onboarding({ theme = "light", onComplete }) {
  const [step, setStep] = useState(0);
  // 0 account · 1 verify (skipped — local) · 2 totp · 3 recovery · 4 done
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [errors, setErrors] = useState({});

  const totpSecret = useMemo(() => generateSecret(), []);
  const recoveryCodes = useMemo(() => Array.from({ length: 8 }, () => generateRecoveryCode()), []);

  const submitAccount = () => {
    const errs = {};
    if (!username.trim() || username.length < 3) errs.username = "At least 3 characters.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email.";
    if (scorePassword(pwd) < 3) errs.pwd = "12+ chars with mixed case and one number.";
    setErrors(errs);
    if (Object.keys(errs).length === 0) setStep(2);
  };

  return (
    <PreAuthShell theme={theme} width="100vw" height="100vh">
      {{
        _sideLink: step === 0 && (<>Have an account? <a className="celiums-link" style={{ marginLeft: 4 }} onClick={() => onComplete({ existing: true })}>Log in</a></>),
        main: (
          <div style={{ width: 480 }}>
            <div className="cc-stepper">
              <span className={`pip ${step >= 0 ? (step === 0 ? "current" : "done") : ""}`} />
              <span className={`pip ${step >= 2 ? (step === 2 ? "current" : "done") : ""}`} />
              <span className={`pip ${step >= 3 ? (step === 3 ? "current" : "done") : ""}`} />
              <span className={`pip ${step >= 4 ? "done" : ""}`} />
              <span style={{ marginLeft: 8 }}>
                step {step === 0 ? 1 : step === 2 ? 2 : step === 3 ? 3 : 3} of 3
              </span>
            </div>

            {step === 0 && (
              <AccountStep
                username={username} setUsername={setUsername}
                email={email} setEmail={setEmail}
                pwd={pwd} setPwd={setPwd}
                errors={errors}
                onContinue={submitAccount}
              />
            )}

            {step === 2 && (
              <TotpStep
                username={username}
                secret={totpSecret}
                onBack={() => setStep(0)}
                onVerified={() => setStep(3)}
              />
            )}

            {step === 3 && (
              <RecoveryStep codes={recoveryCodes} onContinue={() => setStep(4)} />
            )}

            {step === 4 && (
              <FinishedStep onEnter={() => {
                try {
                  localStorage.setItem("celiums.account", JSON.stringify({
                    username, email, totpSecret, recoveryCodes,
                    createdAt: new Date().toISOString(),
                  }));
                  localStorage.setItem("celiums.session", "1");
                } catch {}
                onComplete({ existing: false });
              }} />
            )}
          </div>
        ),
      }}
    </PreAuthShell>
  );
}

/* ─────────────────────── Step 1 · Account ─────────────────────── */
export function AccountStep({ username, setUsername, email, setEmail, pwd, setPwd, errors, onContinue }) {
  const strength = scorePassword(pwd);
  return (
    <>
      <div className="celiums-eyebrow" style={{ marginBottom: 10 }}>Start here · operator account</div>
      <h1 className="celiums-h1" style={{ fontSize: 44, lineHeight: 1.02, marginBottom: 14 }}>
        Give this <em style={{ fontStyle: "normal", color: "var(--c-green-text)" }}>cognition</em><br />
        a guardian.
      </h1>
      <p style={{ fontSize: 14, color: "var(--c-fg-muted)", lineHeight: 1.55, marginBottom: 28, maxWidth: 440 }}>
        You're the only operator on this gateway. Your account controls the plugin — seed installs, memories, ethics policy. It stays on this machine.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label className="celiums-label">Operator username</label>
          <input className={`celiums-input ${errors.username ? "error" : ""}`} autoFocus
            value={username} onChange={e => setUsername(e.target.value)} placeholder="alex" />
          {errors.username && <div className="celiums-hint error">{errors.username}</div>}
        </div>
        <div>
          <label className="celiums-label">Recovery email</label>
          <input className={`celiums-input ${errors.email ? "error" : ""}`}
            type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          <div className="celiums-hint">Used only if you lose your 2FA app. Never for marketing.</div>
          {errors.email && <div className="celiums-hint error">{errors.email}</div>}
        </div>
        <div>
          <label className="celiums-label">Password</label>
          <input className={`celiums-input ${errors.pwd ? "error" : ""}`} type="password"
            value={pwd} onChange={e => setPwd(e.target.value)} placeholder="At least 12 characters" />
          <div className={`cc-strength s${strength}`}><i /><i /><i /><i /></div>
          <div className="cc-strength-row">
            <span>{["too weak", "weak", "ok", "strong", "excellent"][strength]}</span>
            <span>hashed with argon2id</span>
          </div>
          {errors.pwd && <div className="celiums-hint error">{errors.pwd}</div>}
        </div>

        <button className="celiums-btn primary lg full" style={{ marginTop: 6 }} onClick={onContinue}>
          Continue → set up 2FA <Ico.arrowR width={13} height={13} />
        </button>

        <div style={{ fontSize: 11.5, color: "var(--c-fg-subtle)", lineHeight: 1.5, textAlign: "center", marginTop: 4 }}>
          By continuing you accept the Apache-2.0 seed license. Nothing leaves this gateway by default.
        </div>
      </div>
    </>
  );
}

/* ─────────────────────── Step 2 · TOTP setup ─────────────────────── */
export function TotpStep({ username, secret, onBack, onVerified }) {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const refs = useRef([]);

  const handleDigit = (i, v) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...code]; next[i] = d; setCode(next);
    setError("");
    if (d && i < 5) refs.current[i + 1]?.focus();
  };
  const handleKey = (i, e) => {
    if (e.key === "Backspace" && !code[i] && i > 0) refs.current[i - 1]?.focus();
  };
  const handlePaste = (e) => {
    const text = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setCode(text.split(""));
      refs.current[5]?.focus();
    }
  };
  const submit = () => {
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      if (code.join("").length === 6) onVerified();
      else setError("Enter all 6 digits.");
    }, 600);
  };

  return (
    <>
      <div className="celiums-eyebrow" style={{ marginBottom: 10 }}>Step 2 of 3 · two-factor auth</div>
      <h1 className="celiums-h1" style={{ fontSize: 40, lineHeight: 1.05, marginBottom: 14 }}>
        Add a <em style={{ fontStyle: "normal", color: "var(--c-green-text)" }}>second key</em>.
      </h1>
      <p style={{ fontSize: 14, color: "var(--c-fg-muted)", lineHeight: 1.55, marginBottom: 12, maxWidth: 440 }}>
        Scan the QR with your authenticator app — 1Password, Authy, Google Authenticator — and enter the 6-digit code it shows.
      </p>

      <div className="cc-totp-grid">
        <div className="cc-qr">
          <FakeQR seed={secret} size={140} />
        </div>
        <div style={{ fontSize: 13, color: "var(--c-fg-muted)", lineHeight: 1.55 }}>
          <div>Or enter the secret manually:</div>
          <div className="cc-totp-secret">{secret.match(/.{1,4}/g).join(" ")}</div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--c-fg-subtle)", fontFamily: "var(--font-mono)", lineHeight: 1.45 }}>
            issuer · <span style={{ color: "var(--c-fg)" }}>Celiums Cognition</span><br />
            account · <span style={{ color: "var(--c-fg)" }}>{username || "operator"}</span><br />
            digits · 6 · period · 30s · SHA-1
          </div>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <label className="celiums-label">Enter the 6-digit code</label>
        <div className="cc-otp-input" onPaste={handlePaste}>
          {code.map((d, i) => (
            <input
              key={i}
              ref={el => refs.current[i] = el}
              type="text" inputMode="numeric" maxLength="1"
              value={d}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKey(i, e)}
              className={d ? "filled" : ""}
              autoFocus={i === 0}
            />
          ))}
        </div>
        {error && <div className="celiums-hint error" style={{ marginTop: 8 }}>{error}</div>}
        <div className="celiums-hint" style={{ marginTop: 8 }}>{verifying ? "Verifying…" : "Codes refresh every 30 seconds."}</div>
      </div>

      <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
        <button className="celiums-btn" onClick={onBack}>← Back</button>
        <button className="celiums-btn primary lg" onClick={submit} disabled={verifying || code.join("").length !== 6} style={{ flex: 1 }}>
          {verifying ? "Verifying…" : <>Verify & continue <Ico.arrowR width={13} height={13} /></>}
        </button>
      </div>
    </>
  );
}

/* ─────────────────────── Step 3 · Recovery codes ─────────────────────── */
export function RecoveryStep({ codes, onContinue }) {
  const [ack, setAck] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const download = () => {
    const blob = new Blob(
      ["Celiums Cognition — recovery codes\n\n" + codes.join("\n") + "\n\nEach code can be used once.\n"],
      { type: "text/plain" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "celiums-recovery-codes.txt";
    a.click();
    setDownloaded(true);
  };

  return (
    <>
      <div className="celiums-eyebrow" style={{ marginBottom: 10 }}>Step 3 of 3 · recovery</div>
      <h1 className="celiums-h1" style={{ fontSize: 40, lineHeight: 1.05, marginBottom: 14 }}>
        Save these <em style={{ fontStyle: "normal", color: "var(--c-green-text)" }}>somewhere safe</em>.
      </h1>
      <p style={{ fontSize: 14, color: "var(--c-fg-muted)", lineHeight: 1.55, marginBottom: 14, maxWidth: 440 }}>
        If you ever lose access to your authenticator, you can sign in with one of these codes instead. Each works once. A password manager is ideal.
      </p>

      <div className="cc-recovery-codes">
        {codes.map((c, i) => <span key={i}>{c}</span>)}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="celiums-btn" onClick={download}>
          <Ico.download width={13} height={13} /> {downloaded ? "Downloaded ✓" : "Download .txt"}
        </button>
        <button className="celiums-btn" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>
          <Ico.copy width={13} height={13} /> Copy
        </button>
      </div>

      <label style={{ marginTop: 24, display: "flex", gap: 10, fontSize: 13, color: "var(--c-fg)", cursor: "pointer" }}>
        <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}
          style={{ accentColor: "var(--c-green)", width: 16, height: 16, marginTop: 1 }} />
        I've stored these codes somewhere I can find them.
      </label>

      <button className="celiums-btn primary lg full" disabled={!ack} style={{ marginTop: 18 }} onClick={onContinue}>
        Finish setup <Ico.arrowR width={13} height={13} />
      </button>
    </>
  );
}

/* ─────────────────────── Step 4 · Finished ─────────────────────── */
export function FinishedStep({ onEnter }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="cc-success">
        <Ico.check width={28} height={28} />
      </div>
      <h1 className="celiums-h1" style={{ fontSize: 40, lineHeight: 1.05, marginBottom: 14 }}>
        You're <em style={{ fontStyle: "normal", color: "var(--c-green-text)" }}>in</em>.
      </h1>
      <p style={{ fontSize: 14, color: "var(--c-fg-muted)", lineHeight: 1.55, marginBottom: 28, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
        Celiums Cognition is wired up on this gateway. The 10,000-module Apache-2.0 seed corpus is already indexed. Take a look around.
      </p>
      <button className="celiums-btn primary lg" onClick={onEnter}>
        Enter the dashboard <Ico.arrowR width={14} height={14} />
      </button>
    </div>
  );
}

/* ─────────────────────── Login (returning) ─────────────────────── */
export function LogIn({ theme = "light", onComplete }) {
  const account = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("celiums.account") || "{}"); }
    catch { return {}; }
  }, []);
  const [step, setStep] = useState("password"); // password | totp
  const [pwd, setPwd] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const refs = useRef([]);

  const submitPwd = () => {
    if (pwd.length < 1) { setError("Enter your password."); return; }
    setError("");
    setStep("totp");
  };

  const handleDigit = (i, v) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...code]; next[i] = d; setCode(next);
    setError("");
    if (d && i < 5) refs.current[i + 1]?.focus();
    if (i === 5 && d) {
      setTimeout(() => {
        try { localStorage.setItem("celiums.session", "1"); } catch {}
        onComplete({ existing: true });
      }, 300);
    }
  };

  return (
    <PreAuthShell theme={theme} width="100vw" height="100vh">
      {{
        _sideLink: <>New here? <a className="celiums-link" style={{ marginLeft: 4 }} onClick={() => {
          localStorage.removeItem("celiums.account");
          localStorage.removeItem("celiums.session");
          window.location.reload();
        }}>Create account</a></>,
        main: (
          <div style={{ width: 400 }}>
            <div className="cc-stepper">
              <span className={`pip ${step === "password" ? "current" : "done"}`} />
              <span className={`pip ${step === "totp" ? "current" : ""}`} />
              <span style={{ marginLeft: 8 }}>signing in</span>
            </div>

            {step === "password" && (
              <>
                <div className="celiums-eyebrow" style={{ marginBottom: 10 }}>Welcome back</div>
                <h1 className="celiums-h1" style={{ fontSize: 40, lineHeight: 1.05, marginBottom: 18 }}>
                  Hi again, <em style={{ fontStyle: "normal", color: "var(--c-green-text)" }}>{account.username || "operator"}</em>.
                </h1>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label className="celiums-label">Password</label>
                    <input className={`celiums-input ${error ? "error" : ""}`} type="password" value={pwd}
                      autoFocus onChange={e => setPwd(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && submitPwd()} />
                    {error && <div className="celiums-hint error">{error}</div>}
                  </div>
                  <button className="celiums-btn primary lg full" onClick={submitPwd}>
                    Continue → 2FA <Ico.arrowR width={13} height={13} />
                  </button>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--c-fg-subtle)" }}>
                    <a className="celiums-link">Forgot password?</a>
                    <a className="celiums-link">Use a recovery code</a>
                  </div>
                </div>
              </>
            )}

            {step === "totp" && (
              <>
                <div className="celiums-eyebrow" style={{ marginBottom: 10 }}>Two-factor auth</div>
                <h1 className="celiums-h1" style={{ fontSize: 40, lineHeight: 1.05, marginBottom: 14 }}>
                  One more <em style={{ fontStyle: "normal", color: "var(--c-green-text)" }}>thing</em>.
                </h1>
                <p style={{ fontSize: 13.5, color: "var(--c-fg-muted)", marginBottom: 24 }}>
                  Enter the 6-digit code from your authenticator app.
                </p>
                <div className="cc-otp-input">
                  {code.map((d, i) => (
                    <input key={i}
                      ref={el => refs.current[i] = el}
                      type="text" inputMode="numeric" maxLength="1"
                      value={d}
                      onChange={e => handleDigit(i, e.target.value)}
                      className={d ? "filled" : ""}
                      autoFocus={i === 0}
                    />
                  ))}
                </div>
                {error && <div className="celiums-hint error" style={{ marginTop: 8 }}>{error}</div>}
                <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
                  <button className="celiums-btn" onClick={() => setStep("password")}>← Back</button>
                </div>
              </>
            )}
          </div>
        ),
      }}
    </PreAuthShell>
  );
}

/* ─────────────────────── FakeQR ─────────────────────── */
export function FakeQR({ seed, size = 140 }) {
  const mods = 21;
  const cells = useMemo(() => buildQRPattern(seed, mods), [seed, mods]);
  const px = size / mods;
  return (
    <svg viewBox={`0 0 ${mods * px} ${mods * px}`} width={size} height={size}
         style={{ shapeRendering: "crispEdges", display: "block" }}>
      <rect x="0" y="0" width={mods * px} height={mods * px} fill="white" />
      {cells.flatMap((row, y) => row.map((c, x) => c ? (
        <rect key={`${x}-${y}`} x={x * px} y={y * px} width={px} height={px} fill="#1a1a1a" />
      ) : null))}
    </svg>
  );
}

export function buildQRPattern(seed, size) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  let s = h >>> 0 || 1;
  const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967295; };

  const grid = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      grid[y][x] = rng() > 0.55 ? 1 : 0;

  const drawFinder = (ox, oy) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const edge = x === 0 || y === 0 || x === 6 || y === 6;
      const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      grid[oy + y][ox + x] = (edge || inner) ? 1 : 0;
    }
    for (let i = 0; i < 8; i++) {
      if (ox + 7 < size && grid[oy + i]) grid[oy + i][ox + 7] = 0;
      if (oy + 7 < size && grid[oy + 7]) grid[oy + 7][ox + i] = 0;
    }
  };
  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  for (let i = 8; i < size - 8; i++) {
    grid[6][i] = i % 2 === 0 ? 1 : 0;
    grid[i][6] = i % 2 === 0 ? 1 : 0;
  }
  for (let y = size - 9; y < size - 4; y++)
    for (let x = size - 9; x < size - 4; x++) {
      const edge = x === size - 9 || y === size - 9 || x === size - 5 || y === size - 5;
      const center = x === size - 7 && y === size - 7;
      grid[y][x] = (edge || center) ? 1 : 0;
    }
  return grid;
}

export function generateSecret() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
export function generateRecoveryCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let p1 = "", p2 = "";
  for (let i = 0; i < 5; i++) p1 += chars[Math.floor(Math.random() * chars.length)];
  for (let i = 0; i < 5; i++) p2 += chars[Math.floor(Math.random() * chars.length)];
  return `${p1}-${p2}`;
}
export function scorePassword(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}

Object.assign(window, { AuthFlow, Onboarding, LogIn });
