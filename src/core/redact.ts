/**
 * Secret detection and redaction. Used by the hardcoded-secret rule, and
 * applied to all finding evidence before it is reported (defense in depth),
 * so a report never reproduces a credential even if an analyzer quotes one.
 */

export interface SecretPattern {
  kind: string;
  pattern: RegExp;
  /** High-confidence patterns are reported as findings; others are only redacted. */
  highConfidence: boolean;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { kind: 'AWS access key ID', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, highConfidence: true },
  { kind: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, highConfidence: true },
  {
    kind: 'GitHub fine-grained token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
    highConfidence: true,
  },
  { kind: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,250}\b/g, highConfidence: true },
  {
    kind: 'Stripe live secret key',
    pattern: /\b[rs]k_live_[A-Za-z0-9]{16,250}\b/g,
    highConfidence: true,
  },
  { kind: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, highConfidence: true },
  { kind: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,250}/g, highConfidence: true },
  {
    kind: 'OpenAI API key',
    pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,250}/g,
    highConfidence: true,
  },
  {
    kind: 'private key',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
    highConfidence: true,
  },
  {
    kind: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    highConfidence: false,
  },
  {
    kind: 'credential assignment',
    pattern:
      /\b((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*)(["'`])[^"'`\s]{6,}\2/gi,
    highConfidence: false,
  },
];

/** Kinds of high-confidence secrets present in `text`, in pattern order. */
export function detectSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.highConfidence && new RegExp(p.pattern).test(text)).map(
    (p) => p.kind,
  );
}

export function redactSecrets(text: string): string {
  let result = text;
  for (const { kind, pattern } of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern), (_match, assignment: unknown, quote: unknown) =>
      // Keep the variable name for context; drop only the value.
      kind === 'credential assignment' &&
      typeof assignment === 'string' &&
      typeof quote === 'string'
        ? `${assignment}${quote}[REDACTED]${quote}`
        : `[REDACTED ${kind}]`,
    );
  }
  return result;
}
