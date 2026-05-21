/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import QRCode from "qrcode";
import { Ico, PreAuthShell } from "./celiums-primitives.jsx";
import {
  authSignup, authTotpVerify,
  authLogin, authLoginTotp,
} from "./data.js";

/* Onboarding + Login flow — backed by /api/celiums-cognition/auth/*.
 * Server is the source of truth: it generates the TOTP secret + recovery
 * codes at signup, validates TOTP codes against that secret, and gates
 * the session via an HttpOnly cookie. The frontend just walks the user
 * through it visually. */

export function AuthFlow({ mode, theme = "light", onToggleTheme, onComplete }) {
  return mode === "onboard"
    ? <Onboarding theme={theme} onToggleTheme={onToggleTheme} onComplete={onComplete} />
    : <LogIn theme={theme} onToggleTheme={onToggleTheme} onComplete={onComplete} />;
}

/* ─────────────────────── Onboarding (3 steps) ─────────────────────── */
export function Onboarding({ theme = "light", onToggleTheme, onComplete }) {
  const [step, setStep] = useState(0);
  // 0 account · 1 totp setup · 2 recovery · 3 finished
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  // Filled by the signup response on step 0 → 1:
  const [totpUri, setTotpUri] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);

  const submitAccount = async () => {
    const errs = {};
    if (!username.trim() || username.length < 3) errs.username = "At least 3 characters.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email.";
    if (scorePassword(pwd) < 3) errs.pwd = "12+ chars with mixed case and one number.";
    setErrors(errs);
    if (Object.keys(errs).length !== 0) return;
    setSubmitting(true);
    try {
      const r = await authSignup({ username: username.trim(), email: email.trim(), password: pwd });
      setTotpUri(r.totp_uri);
      setTotpSecret(r.totp_secret);
      setRecoveryCodes(r.recovery_codes);
      setStep(1);
    } catch (err) {
      const msg = err?.payload?.error?.message ?? err?.message ?? "Sign-up failed.";
      if (err?.status === 409) {
        setErrors({ form: "An account already exists on this instance. Use Log in." });
      } else {
        setErrors({ form: msg });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PreAuthShell theme={theme} width="100vw" height="100vh" onToggleTheme={onToggleTheme}>
      {{
        _sideLink: step === 0 && (<>Have an account? <a className="celiums-link" style={{ marginLeft: 4 }} onClick={() => onComplete({ existing: true })}>Log in</a></>),
        main: (
          <div style={{ width: 480 }}>
            <div className="cc-stepper">
              <span className={`pip ${step >= 0 ? (step === 0 ? "current" : "done") : ""}`} />
              <span className={`pip ${step >= 1 ? (step === 1 ? "current" : "done") : ""}`} />
              <span className={`pip ${step >= 2 ? (step === 2 ? "current" : "done") : ""}`} />
              <span className={`pip ${step >= 3 ? "done" : ""}`} />
              <span style={{ marginLeft: 8 }}>
                step {Math.min(step + 1, 3)} of 3
              </span>
            </div>

            {step === 0 && (
              <AccountStep
                username={username} setUsername={setUsername}
                email={email} setEmail={setEmail}
                pwd={pwd} setPwd={setPwd}
                errors={errors}
                submitting={submitting}
                onContinue={submitAccount}
              />
            )}

            {step === 1 && (
              <TotpStep
                username={username}
                secret={totpSecret}
                otpauthUri={totpUri}
                onBack={() => setStep(0)}
                onVerified={() => setStep(2)}
              />
            )}

            {step === 2 && (
              <RecoveryStep codes={recoveryCodes} onContinue={() => setStep(3)} />
            )}

            {step === 3 && (
              <FinishedStep onEnter={() => onComplete({ existing: false })} />
            )}
          </div>
        ),
      }}
    </PreAuthShell>
  );
}

/* ─────────────────────── Step 1 · Account ─────────────────────── */
export function AccountStep({ username, setUsername, email, setEmail, pwd, setPwd, errors, submitting, onContinue }) {
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
            value={pwd} onChange={e => setPwd(e.target.value)} placeholder="At least 12 characters"
            onKeyDown={e => e.key === "Enter" && !submitting && onContinue()} />
          <div className={`cc-strength s${strength}`}><i /><i /><i /><i /></div>
          <div className="cc-strength-row">
            <span>{["too weak", "weak", "ok", "strong", "excellent"][strength]}</span>
            <span>hashed pbkdf2-sha256 · 600k iters</span>
          </div>
          {errors.pwd && <div className="celiums-hint error">{errors.pwd}</div>}
        </div>

        {errors.form && (
          <div className="celiums-hint error" style={{ padding: "8px 12px", border: "1px solid var(--c-red, #ef4444)", borderRadius: 6 }}>
            {errors.form}
          </div>
        )}

        <button className="celiums-btn primary lg full" style={{ marginTop: 6 }}
                onClick={onContinue} disabled={submitting}>
          {submitting
            ? "Creating account…"
            : (<>Continue → set up 2FA <Ico.arrowR width={13} height={13} /></>)}
        </button>

        <div style={{ fontSize: 11.5, color: "var(--c-fg-subtle)", lineHeight: 1.5, textAlign: "center", marginTop: 4 }}>
          By continuing you accept the Apache-2.0 seed license. Nothing leaves this gateway by default.
        </div>
      </div>
    </>
  );
}

/* ─────────────────────── Step 2 · TOTP setup ─────────────────────── */
export function TotpStep({ username, secret, otpauthUri, onBack, onVerified }) {
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
    if (e.key === "Enter" && code.join("").length === 6) submit();
  };
  const handlePaste = (e) => {
    const text = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setCode(text.split(""));
      refs.current[5]?.focus();
    }
  };
  const submit = async () => {
    const joined = code.join("");
    if (joined.length !== 6) { setError("Enter all 6 digits."); return; }
    setVerifying(true);
    setError("");
    try {
      await authTotpVerify(joined);
      onVerified();
    } catch (err) {
      const msg = err?.payload?.error?.message ?? err?.message ?? "Verification failed.";
      setError(msg);
      // Reset focus to first digit on failure so the user can re-type.
      setCode(["", "", "", "", "", ""]);
      refs.current[0]?.focus();
    } finally {
      setVerifying(false);
    }
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
          <RealQR otpauthUri={otpauthUri} size={140} />
        </div>
        <div style={{ fontSize: 13, color: "var(--c-fg-muted)", lineHeight: 1.55 }}>
          <div>Or enter the secret manually:</div>
          <div className="cc-totp-secret">{secret ? secret.match(/.{1,4}/g).join(" ") : "…"}</div>
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
        <button className="celiums-btn" onClick={onBack} disabled={verifying}>← Back</button>
        <button className="celiums-btn primary lg" onClick={submit} disabled={verifying || code.join("").length !== 6} style={{ flex: 1 }}>
          {verifying ? "Verifying…" : <>Verify & continue <Ico.arrowR width={13} height={13} /></>}
        </button>
      </div>
    </>
  );
}

/* Real QR rendered via the `qrcode` library — encodes the otpauth:// URI
 * so any authenticator app (1Password, Authy, Google Authenticator) can
 * import it. */
export function RealQR({ otpauthUri, size = 140 }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    if (!otpauthUri) return;
    let cancelled = false;
    QRCode.toDataURL(otpauthUri, {
      width: size * 2, // 2x for retina
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1a1a1a", light: "#ffffff" },
    }).then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [otpauthUri, size]);
  if (!dataUrl) {
    return <div style={{ width: size, height: size, background: "#f3f4f6", borderRadius: 6 }} />;
  }
  return <img src={dataUrl} alt="TOTP QR code" width={size} height={size} style={{ display: "block", borderRadius: 6 }} />;
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
export function LogIn({ theme = "light", onToggleTheme, onComplete }) {
  const [step, setStep] = useState("credentials"); // credentials | totp | totp_setup
  const [identifier, setIdentifier] = useState("");
  const [pwd, setPwd] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [displayName, setDisplayName] = useState("");
  // For the resume-TOTP-setup path (account exists with totp_enabled=false):
  const [resumeSecret, setResumeSecret] = useState("");
  const [resumeUri, setResumeUri] = useState("");
  const refs = useRef([]);

  const submitPwd = async () => {
    if (!identifier.trim() || !pwd) {
      setError("Enter your username/email and password.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const r = await authLogin({ username: identifier.trim(), password: pwd });
      setDisplayName(r.username || "");
      if (r.requires_totp_setup) {
        // Account exists but TOTP enrollment was abandoned. Server has
        // handed us a pending_totp_setup session and the original secret
        // so the user can finish enrolling without re-signing-up.
        setResumeSecret(r.totp_secret);
        setResumeUri(r.totp_uri);
        setStep("totp_setup");
      } else if (r.requires_totp) {
        setStep("totp");
      } else {
        onComplete({ existing: true });
      }
    } catch (err) {
      const msg = err?.payload?.error?.message ?? err?.message ?? "Login failed.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const submitTotp = async (codeStr) => {
    setError("");
    setSubmitting(true);
    try {
      const body = recoveryMode
        ? { recovery_code: recoveryCode.trim() }
        : { code: codeStr };
      await authLoginTotp(body);
      onComplete({ existing: true });
    } catch (err) {
      const msg = err?.payload?.error?.message ?? err?.message ?? "Verification failed.";
      setError(msg);
      if (!recoveryMode) {
        setCode(["", "", "", "", "", ""]);
        refs.current[0]?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDigit = (i, v) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...code]; next[i] = d; setCode(next);
    setError("");
    if (d && i < 5) refs.current[i + 1]?.focus();
    if (i === 5 && d && next.every(Boolean)) {
      submitTotp(next.join(""));
    }
  };
  const handleTotpKey = (i, e) => {
    if (e.key === "Backspace" && !code[i] && i > 0) refs.current[i - 1]?.focus();
  };

  return (
    <PreAuthShell theme={theme} width="100vw" height="100vh" onToggleTheme={onToggleTheme}>
      {{
        _sideLink: <>New here? <a className="celiums-link" style={{ marginLeft: 4 }}
                                    onClick={() => onComplete({ wantOnboard: true })}>Create account</a></>,
        main: (
          <div style={{ width: 400 }}>
            <div className="cc-stepper">
              <span className={`pip ${step === "credentials" ? "current" : "done"}`} />
              <span className={`pip ${step === "totp" ? "current" : ""}`} />
              <span style={{ marginLeft: 8 }}>signing in</span>
            </div>

            {step === "credentials" && (
              <>
                <div className="celiums-eyebrow" style={{ marginBottom: 10 }}>Welcome back</div>
                <h1 className="celiums-h1" style={{ fontSize: 40, lineHeight: 1.05, marginBottom: 18 }}>
                  Sign in to <em style={{ fontStyle: "normal", color: "var(--c-green-text)" }}>Cognition</em>.
                </h1>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label className="celiums-label">Username or email</label>
                    <input className="celiums-input" autoFocus
                      value={identifier} onChange={e => setIdentifier(e.target.value)} />
                  </div>
                  <div>
                    <label className="celiums-label">Password</label>
                    <input className={`celiums-input ${error ? "error" : ""}`} type="password" value={pwd}
                      onChange={e => setPwd(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !submitting && submitPwd()} />
                    {error && <div className="celiums-hint error">{error}</div>}
                  </div>
                  <button className="celiums-btn primary lg full" onClick={submitPwd} disabled={submitting}>
                    {submitting ? "Signing in…" : (<>Continue → 2FA <Ico.arrowR width={13} height={13} /></>)}
                  </button>
                </div>
              </>
            )}

            {step === "totp_setup" && (
              <TotpStep
                username={displayName || identifier}
                secret={resumeSecret}
                otpauthUri={resumeUri}
                onBack={() => setStep("credentials")}
                onVerified={() => onComplete({ existing: true })}
              />
            )}

            {step === "totp" && (
              <>
                <div className="celiums-eyebrow" style={{ marginBottom: 10 }}>Two-factor auth</div>
                <h1 className="celiums-h1" style={{ fontSize: 40, lineHeight: 1.05, marginBottom: 14 }}>
                  {displayName ? <>Hi again, <em style={{ fontStyle: "normal", color: "var(--c-green-text)" }}>{displayName}</em>.</> : "One more thing."}
                </h1>
                {!recoveryMode ? (
                  <>
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
                          onKeyDown={e => handleTotpKey(i, e)}
                          className={d ? "filled" : ""}
                          autoFocus={i === 0}
                          disabled={submitting}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 13.5, color: "var(--c-fg-muted)", marginBottom: 14 }}>
                      Enter one of your recovery codes (each works once).
                    </p>
                    <input className="celiums-input" autoFocus
                      placeholder="XXXXX-XXXXX"
                      value={recoveryCode}
                      onChange={e => setRecoveryCode(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !submitting && submitTotp("")} />
                    <button className="celiums-btn primary lg full" style={{ marginTop: 14 }}
                            onClick={() => submitTotp("")} disabled={submitting || !recoveryCode.trim()}>
                      {submitting ? "Verifying…" : "Use recovery code"}
                    </button>
                  </>
                )}
                {error && <div className="celiums-hint error" style={{ marginTop: 8 }}>{error}</div>}
                <div style={{ marginTop: 22, display: "flex", gap: 8, justifyContent: "space-between" }}>
                  <button className="celiums-btn" onClick={() => setStep("credentials")} disabled={submitting}>← Back</button>
                  <a className="celiums-link" style={{ cursor: "pointer", fontSize: 12 }}
                     onClick={() => { setRecoveryMode(!recoveryMode); setError(""); }}>
                    {recoveryMode ? "Use authenticator code instead" : "Use a recovery code"}
                  </a>
                </div>
              </>
            )}
          </div>
        ),
      }}
    </PreAuthShell>
  );
}

/* Password strength estimator — client-side hint, server still enforces. */
export function scorePassword(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}
