# Architecture

PR Guardian V1 is a **modular monolith**: one Node.js process, run locally or inside a GitHub
Actions job. There is no server, database, queue or dashboard in V1 (spec §16.12, decisions A–D).

## Layers and dependency rules

```text
            ┌──────────── cli/ (composition root) ────────────┐
            │  reads env/config, wires adapters, sets exit code │
            └───┬──────────┬────────────┬────────────┬──────────┘
                │          │            │            │
            config/    github/        ai/       analyzers/
                │          │            │            │
                └──────────┴─────┬──────┴────────────┘
                                 ▼
                     core/ · diff/ · report/   (pure domain)
```

| Layer                       | May depend on                                       | Must not                                                                                              |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `core/`, `diff/`, `report/` | each other; `ai/` and `analyzers/` **by type only** | import GitHub/AI SDKs, `github/`, `cli/`, `config/`; spawn processes; network I/O; read `process.env` |
| `analyzers/`                | domain                                              | import `github/`, `ai/`, any SDK for GitHub or models                                                 |
| `ai/`                       | domain                                              | spawn processes, import `github/` or `analyzers/`                                                     |
| `github/`                   | domain                                              | import `ai/` or `analyzers/`; spawn processes                                                         |
| `config/`                   | domain                                              | import adapters; network I/O                                                                          |
| `cli/`                      | everything                                          | contain review logic                                                                                  |

Only `cli/` and `config/` may read `process.env`, which keeps secrets out of domain code and logs.

These rules live in [`eslint/boundaries.js`](../eslint/boundaries.js), run as part of `npm run lint`,
and are tested in [`tests/unit/architecture/boundaries.test.ts`](../tests/unit/architecture/boundaries.test.ts).
Directories are created when the first real module needs them, not as empty placeholders.

## Decisions log

| #   | Decision                                                                                                                                                                    | Rationale                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Node.js ≥ 22.12, Node 24 LTS by default; `engine-strict`                                                                                                                    | Node 20 reached end of life in April 2026, and current Vitest and ESLint releases require newer runtimes.                                                                          |
| 2   | ESM only (`"type": "module"`, `NodeNext`)                                                                                                                                   | Native Node module system; no dual-package complexity.                                                                                                                             |
| 3   | TypeScript 6.0.x, not 7.x                                                                                                                                                   | `typescript-eslint` (needed for type-aware lint) supports `typescript <6.1`. Revisit when it supports TS 7.                                                                        |
| 4   | Plain `tsc` build, no bundler                                                                                                                                               | Enough for a CLI. How the GitHub Action is packaged (bundled JS action vs. workflow running the CLI) is decided in Milestone 4.                                                    |
| 5   | Boundaries enforced by ESLint (`no-restricted-imports` with `allowTypeImports`) instead of separate packages                                                                | Real enforcement without a monorepo; ports (`ai/provider.ts`, `analyzers/analyzer.ts`) are importable by type only from domain code.                                               |
| 6   | `tsx` for `npm run dev`                                                                                                                                                     | Runs TypeScript sources directly; dev-only dependency.                                                                                                                             |
| 7   | CI: `contents: read`, `pull_request` trigger, SHA-pinned actions, `npm ci --ignore-scripts`, no secrets                                                                     | Least privilege; safe for fork PRs; dependency lifecycle scripts never run in CI.                                                                                                  |
| 8   | Zod 4 for runtime validation; `strictObject` with bounded strings for findings                                                                                              | Analyzer (and later model) output is untrusted; unknown keys such as an analyzer-chosen `id` are rejected outright.                                                                |
| 9   | Finding identity is derived, never supplied: `fingerprint` = hash(path, category, source, rule, title, evidence); `id` = hash(fingerprint, lines)                           | `fingerprint` survives line shifts for rerun deduplication (Milestone 5); `id` keeps separate occurrences distinct.                                                                |
| 10  | First analyzer is a built-in, line-based rule set over added lines, not ESLint or Semgrep                                                                                   | Running the PR's own ESLint config would execute untrusted code. Semgrep with our own rules can be added behind the same port later.                                               |
| 11  | Rules match a masked view of each line (string and comment contents blanked)                                                                                                | Cut false positives on this repository's own diff from 20 to 1 without a full parser.                                                                                              |
| 12  | Status vocabulary: review `completed` / `partial` / `failed` (rendered "Completed with limitations" for partial); analyzer `succeeded` / `failed` / `skipped` / `timed-out` | Resolves the inconsistent terms in the spec. "Tool unavailable" is `skipped` with a diagnostic.                                                                                    |
| 13  | Advisory exit codes: 0 completed, 1 opt-in `--fail-on`, 2 usage, 3 failed                                                                                                   | Review status and policy outcome stay separate (spec §16.9); a failed review can never exit 0.                                                                                     |
| 14  | Secrets are redacted centrally during normalization, and secret-bearing files are never analyzed                                                                            | A report cannot reproduce a credential even if an analyzer quotes one.                                                                                                             |
| 15  | Configuration will be read from the base branch, not the PR head (Milestone 4)                                                                                              | A pull request must not be able to weaken its own review. Until then the engine takes typed options with safe defaults.                                                            |
| 16  | The AI reviewer is an ordinary `Analyzer` (`src/ai/review-diff.ts`)                                                                                                         | Reuses the orchestrator's timeouts, statuses, schema validation, redaction and deduplication, so AI output gets no special trust and an AI failure degrades the review to partial. |
| 17  | Evidence grounding: AI findings must cite a shown file and quote an added line; lines are verified or removed                                                               | Rejects invented findings regardless of how the model was prompted or manipulated.                                                                                                 |
| 18  | Fail closed on secrets: a file with a high-confidence secret anywhere in its hunks is never sent to the model                                                               | Spec §16.7. Lower-confidence patterns are redacted. Finding titles are redacted too.                                                                                               |
| 19  | Per-request nonce delimiters around untrusted diff content                                                                                                                  | Repository content cannot forge the end of its block.                                                                                                                              |
| 20  | Ollama via built-in `fetch`, no SDK; `redirect: 'error'`; byte-capped body reads; status-only error messages                                                                | No new dependency; a response cannot redirect the request elsewhere or flood memory.                                                                                               |
| 21  | Non-loopback AI endpoints require `--allow-remote-ai`                                                                                                                       | Sending source code off the machine must be an explicit choice.                                                                                                                    |
| 22  | Analyzers may report `incomplete`; the AI layer may import the analyzer port by type only                                                                                   | Partial AI coverage (withheld files) is reported honestly; lint still forbids AI code from calling analyzers, the shell or GitHub.                                                 |
