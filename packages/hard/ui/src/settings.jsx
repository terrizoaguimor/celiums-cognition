/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */
import React, { useState, useMemo, useEffect } from "react";
import {
  ENV_GROUPS, authLogout, fetchHealth,
  fetchTimezones, fetchSettingsTimezone, saveSettingsTimezone,
  useQuery,
} from "./data.js";
import { PageHead, SectionCard, HelpPopover, fmtRelative } from "./cc-shell.jsx";

/* Settings tab — operator-facing CELIUMS_* config (read-only for now —
 * the backend does not yet expose a settings PATCH endpoint, so showing
 * a save flow would be dishonest). Account section is live: shows the
 * authenticated user from the parent App, and offers sign-out via the
 * real /auth/logout endpoint. */

export function Settings({ user, showToast }) {
  const groups = ENV_GROUPS;
  const [active, setActive] = useState(groups[0].id);
  const healthQ = useQuery(fetchHealth, []);

  const signOut = async () => {
    if (!confirm("Sign out of this gateway? You'll need your password + TOTP to come back.")) return;
    try { await authLogout(); } catch {}
    window.location.reload();
  };

  return (
    <>
      <PageHead
        eyebrow={`Operator settings · ${user?.username ?? "—"}`}
        title="Settings"
        sub={<>CELIUMS_* environment variables. Read-only for now; edit the gateway env and restart to apply.</>}
        actions={
          <>
            <span className="celiums-chip">read-only</span>
          </>
        }
      />

      <div className="cc-settings-grid">
        <aside className="cc-settings-nav">
          {groups.map((g) => (
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

          <div className="item" onClick={signOut}>
            <span style={{ width: 16, textAlign: "center" }}>↩</span>
            <span>Sign out</span>
          </div>
        </aside>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <SectionCard
            title="⌚  Timezone"
            action={<HelpPopover title="Why this matters">
              <p style={{ margin: "0 0 8px" }}>
                The agent's circadian rhythm is computed against the
                <em> user's local hour</em>, not the VPS clock. If this
                stays at UTC, every "good morning" the agent senses
                happens at the wrong wall-clock time.
              </p>
              <p style={{ margin: "8px 0 0", color: "var(--c-fg-muted)" }}>
                The selection persists to <code>user_profiles.timezone_iana</code>
                and the engine re-reads it on the next telemetry pull —
                no restart needed.
              </p>
            </HelpPopover>}>
            <TimezoneRow showToast={showToast} />
          </SectionCard>

          <SectionCard title="⛨  Account" count={user?.totp_enabled ? "2FA active" : "2FA inactive"}>
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "150px 1fr", rowGap: 10, fontSize: 13 }}>
              <div style={{ color: "var(--c-fg-muted)" }}>Username</div>
              <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>{user?.username ?? "—"}</div>
              <div style={{ color: "var(--c-fg-muted)" }}>Email</div>
              <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>{user?.email ?? "—"}</div>
              <div style={{ color: "var(--c-fg-muted)" }}>TOTP</div>
              <div style={{ color: "var(--c-fg)" }}>
                {user?.totp_enabled ? (
                  <span className="celiums-chip green">enabled</span>
                ) : (
                  <span className="celiums-chip amber">not enrolled</span>
                )}
              </div>
              <div style={{ color: "var(--c-fg-muted)" }}>Created</div>
              <div style={{ color: "var(--c-fg)" }}>
                {user?.created_at ? fmtRelative(user.created_at) : "—"}
              </div>
            </div>
          </SectionCard>

          {groups.map((g) => (
            <div key={g.id} id={`grp-${g.id}`}>
              <SectionCard title={`${g.icon}  ${g.label}`} count={g.items.length}>
                {g.items.map((it) => (
                  <EnvRow key={it.key} item={it} />
                ))}
              </SectionCard>
            </div>
          ))}

          {healthQ.data && (
            <SectionCard title="◌  Runtime info">
              <div style={{ padding: 14, display: "grid", gridTemplateColumns: "180px 1fr", rowGap: 8, fontSize: 12.5 }}>
                <div style={{ color: "var(--c-fg-muted)" }}>plugin version</div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>{healthQ.data.version}</div>
                <div style={{ color: "var(--c-fg-muted)" }}>edition</div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>{healthQ.data.edition}</div>
                {Object.entries(healthQ.data.stack ?? {}).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <div style={{ color: "var(--c-fg-muted)" }}>{k}</div>
                    <div style={{ fontFamily: "var(--font-mono)", color: v?.ok ? "var(--c-green-text)" : "var(--c-red-text)" }}>
                      {v?.ok ? "● up" : "○ down"} · {v?.endpoint ?? "—"}{v?.model ? ` · ${v.model}` : ""}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </>
  );
}

/** Timezone selector — fetches the IANA list once, persists on change. */
export function TimezoneRow({ showToast }) {
  const tzQ = useQuery(fetchSettingsTimezone, []);
  const listQ = useQuery(fetchTimezones, []);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    if (tzQ.data?.iana) setCurrent(tzQ.data.iana);
  }, [tzQ.data]);

  const list = listQ.data?.timezones ?? [];
  const filtered = useMemo(() => {
    if (!filter.trim()) return list.slice(0, 60);
    const n = filter.toLowerCase();
    return list.filter((tz) => tz.toLowerCase().includes(n)).slice(0, 200);
  }, [list, filter]);

  const save = async (iana) => {
    setSaving(true);
    try {
      const r = await saveSettingsTimezone(iana);
      setCurrent(r.iana);
      showToast?.(`Timezone saved: ${r.iana}`);
    } catch (err) {
      showToast?.(`Save failed: ${err?.message ?? "error"}`);
    } finally {
      setSaving(false);
    }
  };

  const browserGuess = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", rowGap: 10, fontSize: 13, marginBottom: 14 }}>
        <div style={{ color: "var(--c-fg-muted)" }}>Current</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--c-fg)" }}>
            {tzQ.loading ? "loading…" : (current ?? "UTC")}
          </span>
          {current === "UTC" && (
            <span className="celiums-chip amber">default — set yours below</span>
          )}
          {browserGuess && browserGuess !== current && (
            <button className="celiums-btn sm" onClick={() => save(browserGuess)} disabled={saving}>
              Use browser ({browserGuess})
            </button>
          )}
        </div>
      </div>

      <input
        className="celiums-input"
        type="text"
        placeholder="Search timezones — e.g. Bogota, Madrid, Tokyo…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      {listQ.loading && (
        <div style={{ fontSize: 12, color: "var(--c-fg-subtle)" }}>loading timezone list…</div>
      )}

      <div style={{
        maxHeight: 280, overflowY: "auto",
        border: "1px solid var(--c-divider)", borderRadius: 6,
      }}>
        {filtered.map((tz) => (
          <button
            key={tz}
            type="button"
            onClick={() => save(tz)}
            disabled={saving || tz === current}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 12px", border: 0,
              background: tz === current ? "var(--c-green-soft)" : "transparent",
              color: tz === current ? "var(--c-green-text)" : "var(--c-fg)",
              cursor: tz === current ? "default" : "pointer",
              fontFamily: "var(--font-mono)", fontSize: 12.5,
              borderBottom: "1px solid var(--c-divider)",
            }}>
            {tz}{tz === current ? "  ← current" : ""}
          </button>
        ))}
        {filtered.length === 0 && !listQ.loading && (
          <div style={{ padding: 16, fontSize: 12, color: "var(--c-fg-subtle)" }}>
            No timezones match "{filter}".
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: "var(--c-fg-subtle)" }}>
        {list.length > 0 && `${list.length} IANA zones · showing ${filtered.length}`}
      </div>
    </div>
  );
}

export function EnvRow({ item }) {
  return (
    <div className="cc-env-row">
      <div>
        <div className="k">{item.key}</div>
        <div className="desc">{item.desc}</div>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--c-fg-subtle)" }}>
        {item.kind === "secret" ? "(set via env)" : item.placeholder ?? "—"}
      </div>
      <div className="badge">env</div>
    </div>
  );
}
