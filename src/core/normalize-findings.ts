import { createHash } from 'node:crypto';

import { normalizeRepoPath } from '../diff/paths.js';
import { redactSecrets } from './redact.js';
import { FindingCandidateSchema, type FindingCandidate, type ReviewFinding } from './schema.js';

export interface NormalizeResult {
  findings: ReviewFinding[];
  /** Why candidates were dropped. Never contains finding text, only field names and reasons. */
  diagnostics: string[];
}

/**
 * Validate untrusted finding candidates and turn them into normalized,
 * identified findings. Invalid candidates and candidates that reference a file
 * outside the reviewed change are dropped with a diagnostic (spec FR-4, §16.7).
 */
export function normalizeFindings(
  candidates: readonly unknown[],
  reviewedPaths: ReadonlySet<string>,
): NormalizeResult {
  const findings: ReviewFinding[] = [];
  const diagnostics: string[] = [];

  candidates.forEach((raw, index) => {
    const parsed = FindingCandidateSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      diagnostics.push(`Dropped invalid finding #${String(index + 1)} (${issues}).`);
      return;
    }

    let filePath: string;
    try {
      filePath = normalizeRepoPath(parsed.data.filePath);
    } catch {
      diagnostics.push(
        `Dropped finding #${String(index + 1)}: file path is not a safe repository path.`,
      );
      return;
    }
    if (!reviewedPaths.has(filePath)) {
      diagnostics.push(
        `Dropped finding #${String(index + 1)}: it references a file that is not part of the reviewed change.`,
      );
      return;
    }

    findings.push(identify(clean({ ...parsed.data, filePath })));
  });

  return { findings, diagnostics };
}

function clean(candidate: FindingCandidate): FindingCandidate {
  const result: FindingCandidate = {
    ...candidate,
    title: collapseWhitespace(redactSecrets(candidate.title)),
    explanation: redactSecrets(candidate.explanation),
    evidence: redactSecrets(candidate.evidence),
  };
  if (candidate.suggestedFix !== undefined)
    result.suggestedFix = redactSecrets(candidate.suggestedFix);
  return result;
}

/**
 * `fingerprint` ignores line numbers so the same issue keeps its identity when
 * surrounding code moves (rerun deduplication, spec §11). `id` adds the line so
 * two occurrences of the same issue in one file stay distinct.
 */
function identify(finding: FindingCandidate): ReviewFinding {
  const fingerprint = hash([
    finding.filePath,
    finding.category,
    finding.source,
    finding.ruleId ?? '',
    finding.title.toLowerCase(),
    collapseWhitespace(finding.evidence).slice(0, 200),
  ]);
  const id = hash([fingerprint, String(finding.startLine ?? 0), String(finding.endLine ?? 0)]);
  return { ...finding, id, fingerprint };
}

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
