export type FileChangeStatus = 'added' | 'modified' | 'removed' | 'renamed';

export interface AddedLine {
  /** 1-based line number in the new version of the file. */
  line: number;
  content: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  addedLines: AddedLine[];
  removedCount: number;
}

/** One file in a parsed diff. Paths are validated and normalized repository paths. */
export interface DiffFile {
  path: string;
  /** Present for renames: the path before the change. */
  previousPath?: string;
  status: FileChangeStatus;
  binary: boolean;
  hunks: Hunk[];
  /** Size in bytes of this file's section of the diff. */
  patchBytes: number;
}

export type DiffErrorCode =
  'empty-input' | 'diff-too-large' | 'too-many-files' | 'malformed-diff' | 'unsafe-path';

/** Raised for input that must be rejected. Messages never echo large input. */
export class DiffError extends Error {
  readonly code: DiffErrorCode;

  constructor(code: DiffErrorCode, message: string) {
    super(message);
    this.name = 'DiffError';
    this.code = code;
  }
}
