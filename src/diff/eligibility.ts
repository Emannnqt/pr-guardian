import type { DiffLimits } from './limits.js';
import type { AddedLine, DiffFile, Hunk } from './types.js';

export type SupportedLanguage = 'typescript' | 'javascript';

export type SkipReason =
  | 'removed'
  | 'binary'
  | 'secret-bearing-path'
  | 'excluded-path'
  | 'unsupported-language'
  | 'file-too-large'
  | 'no-added-lines';

/** Which changed files are analyzed. Secret-bearing paths are always excluded. */
export interface EligibilityPolicy {
  /** Extension (with dot) to language. Only these files are analyzed. */
  languages: Readonly<Record<string, SupportedLanguage>>;
  /** Any path segment equal to one of these excludes the file. */
  excludedDirectories: readonly string[];
  /** File-name suffixes to exclude (generated or minified code). */
  excludedSuffixes: readonly string[];
}

export const DEFAULT_ELIGIBILITY_POLICY: Readonly<EligibilityPolicy> = {
  languages: {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
  },
  excludedDirectories: ['node_modules', 'dist', 'build', 'coverage', 'vendor', '.git'],
  excludedSuffixes: ['.d.ts', '.min.js', '.bundle.js'],
};

/**
 * Files that commonly hold credentials. They are never analyzed, so their
 * contents can never be quoted as evidence or (later) sent to a model.
 */
const SECRET_BEARING_NAME =
  /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks|keystore|kdbx)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.npmrc|\.netrc|\.pypirc|\.htpasswd|credentials(?:\..*)?|secrets?\.(?:json|ya?ml|toml))$/i;

export interface EligibleFile {
  path: string;
  language: SupportedLanguage;
  addedLines: AddedLine[];
  /** Added lines left out because they exceed the line-length limit. */
  skippedLongLines: number;
  /** Hunks with full line context; over-long lines are removed here too. */
  hunks: Hunk[];
}

export interface SkippedFile {
  path: string;
  reason: SkipReason;
}

export interface Eligibility {
  eligible: EligibleFile[];
  skipped: SkippedFile[];
}

export function classifyFiles(
  files: readonly DiffFile[],
  policy: EligibilityPolicy,
  limits: Pick<DiffLimits, 'maxFileBytes' | 'maxLineLength'>,
): Eligibility {
  const eligible: EligibleFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    const reason = skipReason(file, policy, limits);
    if (reason !== undefined) {
      skipped.push({ path: file.path, reason });
      continue;
    }
    const all = file.hunks.flatMap((h) => h.addedLines);
    const addedLines = all.filter((l) => l.content.length <= limits.maxLineLength);
    eligible.push({
      path: file.path,
      language: languageOf(file.path, policy) ?? 'javascript',
      addedLines,
      skippedLongLines: all.length - addedLines.length,
      hunks: file.hunks.map((h) => ({
        ...h,
        lines: h.lines.filter((l) => l.content.length <= limits.maxLineLength),
      })),
    });
  }
  return { eligible, skipped };
}

function skipReason(
  file: DiffFile,
  policy: EligibilityPolicy,
  limits: Pick<DiffLimits, 'maxFileBytes'>,
): SkipReason | undefined {
  const segments = file.path.split('/');
  const name = segments.at(-1) ?? '';

  if (SECRET_BEARING_NAME.test(name)) return 'secret-bearing-path';
  if (file.status === 'removed') return 'removed';
  if (file.binary) return 'binary';
  if (segments.some((s) => policy.excludedDirectories.includes(s))) return 'excluded-path';
  if (policy.excludedSuffixes.some((suffix) => name.endsWith(suffix))) return 'excluded-path';
  if (languageOf(file.path, policy) === undefined) return 'unsupported-language';
  if (file.patchBytes > limits.maxFileBytes) return 'file-too-large';
  if (!file.hunks.some((h) => h.addedLines.length > 0)) return 'no-added-lines';
  return undefined;
}

function languageOf(path: string, policy: EligibilityPolicy): SupportedLanguage | undefined {
  const dot = path.lastIndexOf('.');
  if (dot <= path.lastIndexOf('/')) return undefined;
  return policy.languages[path.slice(dot).toLowerCase()];
}
