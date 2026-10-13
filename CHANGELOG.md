# Changelog

## v1.0.0 (2026-10-13)

First release. PR Guardian reviews pull request changes with deterministic rules and an optional
local AI reviewer, and reports evidence-backed findings.

### Included

- **Review engine.** Parses git diffs and GitHub patches with strict limits and path validation;
  six built-in rules for TypeScript and JavaScript (hardcoded secrets, disabled TLS verification,
  shell command interpolation, dynamic code execution, focused tests, debugger statements) that
  match code, not strings or comments. Findings are schema-validated, redacted, deduplicated and
  given stable fingerprints.
- **Honest reporting.** Every review is _Completed_, _Completed with limitations_ or _Failed_;
  analyzer failures, size limits and unanalyzed files are stated. Markdown and JSON reports with
  all pull request text escaped.
- **CLI.** `pr-guardian review <diff | ->` with `--format`, `--min-severity`, `--fail-on`, and
  advisory exit codes by default.
- **Optional local AI review** (`--mode hybrid`, Ollama). The model sees only nonce-delimited
  hunks; secret-bearing files are never sent; replies must be valid, size-capped JSON whose
  findings quote an added line of the diff; failures degrade to a rules-only review marked as
  limited. Remote endpoints require explicit opt-in.
- **GitHub Action** (`uses: Emannnqt/pr-guardian@v1`). Reads the pull request through the REST API
  without checking out or running its code; publishes the job summary with read-only permissions;
  works for fork pull requests; refuses `pull_request_target`.
- **Inline comments** (opt-in, `pull-requests: write`). One `COMMENT` review per run on added lines
  only; re-runs post nothing new; spoof-resistant duplicate detection; never edits or deletes
  comments; capped per run.
- **Evaluation.** 27 labeled pull-request diffs, a scoring harness (`npm run eval`) and published
  methodology. Rules-only: 90.0% precision, 47.4% recall, 14.3% clean-case false-positive rate.
  Hybrid with `qwen2.5-coder:3b` on a CPU-only laptop (one run): 77.3% precision, 89.5% recall,
  42.9% clean-case false-positive rate, about 42 s per case. See
  [docs/evaluation.md](docs/evaluation.md).
- **Ollama adapter streams responses**, so slow CPU-only models are limited only by
  `--ai-timeout` (found during evaluation: a non-streaming request hit fetch's built-in
  5-minute wait for response headers).

### Known limitations

- Line-based rules: no data-flow, authorization or logic analysis; a pattern inside a multi-line
  string can be a false positive. Only added lines are reviewed.
- TypeScript and JavaScript only.
- AI review runs only in the local CLI and depends heavily on the model; small local models are
  slow on CPU, miss issues and add false positives. Findings from rules and AI on the same line
  are not merged.
- A pull request can edit the workflow that reviews it; enforcement needs a required check and
  CODEOWNERS on `.github/`.
- Evaluation numbers describe a small, author-written dataset, not real-world performance.
