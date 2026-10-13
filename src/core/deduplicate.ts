import { SEVERITY_RANK, type ReviewFinding } from './schema.js';

/**
 * Collapse findings with the same `id` (same issue, same location), keeping
 * the most severe, then most confident, copy. Never merges distinct
 * locations, so high-impact results are not silently erased.
 */
export function deduplicateFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  const byId = new Map<string, ReviewFinding>();
  for (const finding of findings) {
    const existing = byId.get(finding.id);
    if (existing === undefined || outranks(finding, existing)) byId.set(finding.id, finding);
  }
  return [...byId.values()].sort(compareFindings);
}

function outranks(a: ReviewFinding, b: ReviewFinding): boolean {
  const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  return severity !== 0 ? severity < 0 : a.confidence > b.confidence;
}

/** Deterministic report order: severity, path, line, rule, title. */
export function compareFindings(a: ReviewFinding, b: ReviewFinding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    compareStrings(a.filePath, b.filePath) ||
    (a.startLine ?? 0) - (b.startLine ?? 0) ||
    compareStrings(a.ruleId ?? '', b.ruleId ?? '') ||
    compareStrings(a.title, b.title) ||
    compareStrings(a.id, b.id)
  );
}

// Code-unit comparison, independent of the host locale.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
