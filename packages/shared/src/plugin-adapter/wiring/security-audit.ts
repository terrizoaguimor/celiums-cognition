/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Security audit collector — Fase E.
//
// Surfaces recent ethics block/flag decisions to the gateway's
// central security audit log. Doctrine G1 + G3: governance signals
// propagate beyond the plugin's own audit table to the gateway-wide
// view, with layered source attribution.
//
// Verified shape (types-BsgRSTcu2.d.ts:884-890):
//   SecurityAuditFinding = {
//     checkId, severity (info|warn|critical), title, detail, remediation?
//   }
// The collector is invoked by the gateway at audit time, not on every
// block. Reads up to AUDIT_FINDINGS_LIMIT recent rows. Block messages
// are TRUNCATED before export (G2: opaque categories beat verbatim
// user content).

import type { PluginContext } from "../context.js";

const AUDIT_FINDINGS_LIMIT = 25;

export function wireSecurityAuditCollector(ctx: PluginContext): void {
  const { api, getEngine, extractEnginePool } = ctx;

  const registerSecurityAuditCollector = (
    api as unknown as { registerSecurityAuditCollector?: (collector: unknown) => void }
  ).registerSecurityAuditCollector;
  if (typeof registerSecurityAuditCollector !== "function") {
    api.logger.warn?.(
      `celiums-cognition: api.registerSecurityAuditCollector not available — gateway audit will not include ethics findings`,
    );
    return;
  }

  try {
    registerSecurityAuditCollector.call(api, async () => {
      try {
        const engine = await getEngine();
        const pool = extractEnginePool(engine);
        if (!pool) return [];
        const { rows } = await (pool as unknown as {
          query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
        }).query(
          `SELECT id, created_at, final_decision, confidence,
                  reason, detected_categories, blocked, law_violated
             FROM ethics_audit
            WHERE final_decision IN ('block', 'flag')
            ORDER BY created_at DESC
            LIMIT $1`,
          [AUDIT_FINDINGS_LIMIT],
        );
        return rows.map((r) => {
          const decision = String(r.final_decision ?? "block");
          const categories = Array.isArray(r.detected_categories)
            ? (r.detected_categories as string[]).join(", ")
            : String(r.detected_categories ?? "policy");
          const severity =
            decision === "block" || r.blocked === true ? "critical" : "warn";
          const when =
            r.created_at instanceof Date
              ? r.created_at.toISOString()
              : String(r.created_at ?? "");
          return {
            checkId: `celiums-cognition.ethics.${decision}.${String(r.id).slice(0, 8)}`,
            severity,
            title: `Ethics ${decision} — ${categories}`,
            detail:
              `Plugin ethics pipeline ${decision} at ${when}` +
              (typeof r.confidence === "number"
                ? ` (confidence ${r.confidence.toFixed(2)})`
                : ""),
            remediation:
              decision === "block"
                ? "Review the offending request in /api/celiums-cognition/ethics/events and adjust the relevant ethics rule if false-positive."
                : "Flag-only — no action required; inspect via the Ethics tab of the cognition dashboard.",
          };
        });
      } catch {
        // ethics_audit may not exist on a fresh stack — return empty
        // findings rather than fail the gateway audit run.
        return [];
      }
    });
    api.logger.info(`celiums-cognition: registered security audit collector`);
  } catch (err) {
    api.logger.warn?.(
      `celiums-cognition: failed to register security audit collector: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
