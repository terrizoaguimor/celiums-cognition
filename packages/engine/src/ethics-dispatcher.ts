/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 * Originally derived from celiums-memory v2.0
 * (https://github.com/terrizoaguimor/celiums-memory, Apache 2.0)
 */
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Celiums Solutions LLC

/**
 * @celiums-memory/core — Ethics Dispatcher
 *
 * Single-call classification helper used by Layer C of the ethics
 * pipeline. PII is sanitized out before the prompt leaves the box;
 * the LLM gets a plain task prompt ("evaluate from X framework, return
 * JSON") with no pretext, no safety-filter bypass, no retry-on-refusal.
 *
 * Doctrine (RADAR, not a JAIL): the engine classifies and logs for
 * audit. If the model refuses the classification, we accept that and
 * fall back to the rules-based assessment from `ethics-layer-c`. We
 * do NOT iterate across models looking for one that answers, and we
 * do NOT wrap the content in framing that asks the model to ignore
 * its own safety policy.
 *
 * Historical note (May 2026 audit response): prior versions of this
 * file included `buildEthicalFrame` (a "safety research / automated
 * audit" pretext) and `dispatch` (a retry loop that walked model
 * fallbacks until one answered). Both were removed because they
 * functioned as a model-safety-filter bypass rather than as a radar
 * — directly contradicting the doctrine the docstring claimed to
 * uphold. PII sanitization, JSON extraction, and audit entries are
 * retained.
 *
 * @license Apache-2.0
 */

import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SanitizedContent {
  /** SHA-256 of the original content for audit trail */
  contentHash: string;
  /** Length of the original (pre-sanitization) content in characters.
   *  Used by the audit entry to report the real raw length without
   *  forcing the caller to keep the original string around. */
  originalContentLength: number;
  /** Sanitized version safe to send to LLM evaluators */
  sanitized: string;
  /** Metadata about what was sanitized */
  sanitizationMeta: {
    piiRedacted: boolean;
    redactionCount: number;
    redactionMap: Map<string, string>;
  };
}

export interface ClassifyResult {
  /** Parsed { verdict, reasoning, confidence } when the LLM returned
   *  the expected JSON; null when the model declined, errored, or
   *  returned non-parseable output. */
  parsed: { verdict: string; reasoning: string; confidence: number } | null;
  /** The raw LLM response (or stringified error) for audit. */
  rawResponse: string;
  /** Which model produced the response. */
  modelUsed: string;
  /** True when `parsed` is null because the LLM declined or returned
   *  non-JSON. Callers should fall back to rules-based assessment in
   *  that case — they MUST NOT re-prompt with framing designed to
   *  bypass the refusal. */
  refused: boolean;
}

export interface AuditEntry {
  contentHash: string;
  timestamp: number;
  layerADecision: 'allow' | 'flag' | 'block';
  layerCDecision: 'permit' | 'concern' | 'forbid';
  frameworks: string[];
  rawContentLength: number;
  sanitizedContentLength: number;
}

// ═══════════════════════════════════════════════════════════════
// PII SANITIZER
// ═══════════════════════════════════════════════════════════════

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]' },
  { name: 'phone', pattern: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE_REDACTED]' },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  { name: 'credit_card', pattern: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]' },
  { name: 'ip_address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP_REDACTED]' },
  { name: 'url', pattern: /https?:\/\/[^\s]+/g, replacement: '[URL_REDACTED]' },
];

export function sanitizeContent(content: string): SanitizedContent {
  const contentHash = createHash('sha256').update(content).digest('hex');
  const redactionMap = new Map<string, string>();
  let sanitized = content;
  let redactionCount = 0;

  for (const { name, pattern, replacement } of PII_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    const matches = sanitized.match(pattern);
    if (matches) {
      for (const match of matches) {
        const placeholder = `[REDACTED_${name.toUpperCase()}_${++redactionCount}]`;
        redactionMap.set(placeholder, match);
        sanitized = sanitized.replaceAll(match, placeholder);
      }
    }
  }

  return {
    contentHash,
    originalContentLength: content.length,
    sanitized,
    sanitizationMeta: {
      piiRedacted: redactionCount > 0,
      redactionCount,
      redactionMap,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// CLASSIFICATION PROMPT
// ═══════════════════════════════════════════════════════════════

// Plain framework descriptions used inside a direct classification
// prompt. No pretext, no "safety research" framing, no instruction to
// ignore the model's safety policy — if the model declines, the call
// site falls back to the rules-based assessment.
const FRAMEWORK_TASKS: Record<string, string> = {
  consequentialism:
    'From a CONSEQUENTIALIST perspective (Mill, Singer): who would benefit, who would be harmed, is the net utility positive or negative?',
  deontology:
    'From a DEONTOLOGICAL perspective (Kant): does it pass the categorical imperative? Does it treat persons as ends in themselves?',
  virtue:
    'From a VIRTUE ETHICS perspective (Aristotle, MacIntyre): what would a person of practical wisdom do? Does this reflect courage, temperance, justice, prudence?',
  contractualism:
    'From a CONTRACTUALIST perspective (Rawls): would it be accepted behind the veil of ignorance? Does it protect the least advantaged?',
  care:
    'From a CARE ETHICS perspective (Gilligan, Noddings): who is vulnerable? What does care for affected parties require?',
};

function buildClassificationPrompt(
  content: string,
  framework: string,
  context: string = '',
): string {
  const task = FRAMEWORK_TASKS[framework] ||
    `Evaluate the ethical dimensions from a ${framework} perspective.`;
  const ctxBlock = context ? `\nContext: ${context}` : '';
  return [
    `Classify the following content. ${task}`,
    `\nContent:\n"${content}"${ctxBlock}`,
    `\nRespond in exactly this JSON format and nothing else:`,
    `{"verdict": "permit" or "concern" or "forbid", "reasoning": "one paragraph of ethical analysis", "confidence": 0.0 to 1.0}`,
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════
// SINGLE-CALL CLASSIFIER
// ═══════════════════════════════════════════════════════════════

export function extractJsonFromResponse(response: string): { verdict: string; reasoning: string; confidence: number } | null {
  const jsonMatch = response.match(/\{[\s\S]*?"verdict"[\s\S]*?\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const verdict = ['permit', 'concern', 'forbid'].includes(parsed.verdict) ? parsed.verdict : 'concern';
    return {
      verdict,
      reasoning: String(parsed.reasoning || '').slice(0, 500),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
    };
  } catch {
    return null;
  }
}

async function callWithTimeout(
  fn: () => Promise<string>,
  timeoutMs: number,
  modelName: string,
): Promise<string> {
  if (!timeoutMs) return fn();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Classification timeout: ${modelName} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    fn().then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Run one ethical classification against a single model. No retry, no
 * model-fallback, no prompt-level safety-filter bypass. If the model
 * declines or returns non-JSON, the result carries `refused: true` and
 * the caller falls back to the rules-based assessment.
 */
export async function classifyOnce(
  call: (prompt: string) => Promise<string>,
  modelName: string,
  sanitized: SanitizedContent,
  framework: string,
  context: string = '',
  timeoutMs: number = 15000,
): Promise<ClassifyResult> {
  const prompt = buildClassificationPrompt(sanitized.sanitized, framework, context);
  try {
    const rawResponse = await callWithTimeout(() => call(prompt), timeoutMs, modelName);
    const parsed = extractJsonFromResponse(rawResponse);
    return { parsed, rawResponse, modelUsed: modelName, refused: parsed === null };
  } catch (err) {
    return {
      parsed: null,
      rawResponse: err instanceof Error ? err.message : String(err),
      modelUsed: modelName,
      refused: false,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════

export function createAuditEntry(
  sanitized: SanitizedContent,
  layerADecision: 'allow' | 'flag' | 'block',
  layerCResult: { aggregatedVerdict: string; frameworks: Array<{ framework: string }> },
): AuditEntry {
  return {
    contentHash: sanitized.contentHash,
    timestamp: Date.now(),
    layerADecision,
    layerCDecision: layerCResult.aggregatedVerdict as 'permit' | 'concern' | 'forbid',
    frameworks: layerCResult.frameworks.map(f => f.framework),
    // Audit fix (May 2026): the prior version set both fields to
    // `sanitized.sanitized.length`, hiding any PII-redaction
    // size delta. Now `rawContentLength` reports the real pre-
    // sanitization length so log readers can tell when redaction
    // changed the size.
    rawContentLength: sanitized.originalContentLength,
    sanitizedContentLength: sanitized.sanitized.length,
  };
}
