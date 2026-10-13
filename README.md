# PR Guardian

> Catch evidence-backed problems in pull requests before they reach production.

PR Guardian is a GitHub pull request reviewer that combines deterministic static analysis with
optional, schema-validated AI review. It is an assistant, not an authority: **a report with no
findings does not mean the code is correct or secure.**

> **Status: early development (Milestone 5 of 6).** The review engine runs locally (rules-only, or
> with an optional local AI reviewer) and as a GitHub Action that publishes a job summary and,
> optionally, inline comments on pull requests. Evaluation results are not published yet. This
> README only describes what exists today.

## Design goals

- **Review the change, not the repository.** Analyze only the pull request diff and bounded context.
- **Deterministic first.** Static-analysis findings are the reproducible baseline; AI is optional.
- **Validate every boundary.** Diffs, configuration, tool output and model output are untrusted.
- **Fail honestly.** Failed or partial analysis is never reported as a clean review.
- **Least privilege.** Minimal GitHub token permissions; no untrusted PR code runs with secrets.

## Requirements

- Node.js **22.12 or newer** (24 LTS recommended; see [`.nvmrc`](.nvmrc))
- npm 10+

## Quick start (development)

```sh
nvm use            # selects the Node version from .nvmrc
npm ci
npm run check      # typecheck, lint, format check, tests, build
npm run dev -- --help
```

## Using the GitHub Action

Add `.github/workflows/pr-guardian.yml` to a repository:

```yaml
name: PR Guardian
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: read
jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: Emannnqt/pr-guardian@<full-commit-sha> # pin a release commit
        with:
          fail-on: high # optional; omit for advisory-only reviews
```

The review appears as the job summary on the run (the pull request's **Checks** tab). It needs
no write permission, so it also works for pull requests from forks. The Action reads the change
through the GitHub API; it never checks out or executes pull request code. It runs the built-in
rules only (AI review is local-only for now).

| Input                 | Default               | Meaning                                                                   |
| --------------------- | --------------------- | ------------------------------------------------------------------------- |
| `min-severity`        | `low`                 | Lowest severity listed; hidden findings are still counted                 |
| `fail-on`             | (empty)               | Fail the step if a listed finding is at or above this severity            |
| `exclude-paths`       | (empty)               | Extra paths to skip, one per line, e.g. `src/generated`                   |
| `max-files`           | `300`                 | Fail the review above this many changed files (can only be lowered)       |
| `max-file-bytes`      | `100000`              | Skip files with a larger diff (can only be lowered)                       |
| `github-token`        | `${{ github.token }}` | Token with `pull-requests: read` and `contents: read`                     |
| `inline-comments`     | `false`               | Also post inline comments on changed lines (needs `pull-requests: write`) |
| `max-inline-comments` | `10`                  | Most inline comments per run (1–50); the rest stay in the summary         |
| `comment-author`      | `github-actions[bot]` | Whose comments count as PR Guardian's (change only for custom tokens)     |

Outputs: `status` (`completed`, `partial`, `failed`), `finding-count`, `report-path` (JSON report),
`inline-comments-posted`. The step fails when the review fails, `fail-on` is met, or inline comments
were enabled but could not be posted; otherwise it passes, with a warning when the review completed
with limitations.

### Inline comments

With `inline-comments: true` and `permissions: pull-requests: write`, findings are also posted as
review comments on the exact added lines, as **one review per run** with event `COMMENT` (PR
Guardian never approves or requests changes).

- Only **added** lines get comments; findings without one stay in the summary.
- **Reruns do not repeat comments.** Each comment carries a hidden fingerprint; a finding is
  skipped when a PR Guardian comment with the same fingerprint is still on that line. GitHub keeps
  comments attached as surrounding code moves, so shifted findings are not reposted; a finding on
  rewritten code is commented once more on its new line.
- Only comments written by `comment-author` count, so a fingerprint pasted into someone else's
  comment cannot suppress a finding.
- PR Guardian never edits or deletes comments, its own or anyone else's.
- Pull requests from forks get a read-only token, so inline comments are skipped with a notice and
  the job summary is still published. See [docs/security.md](docs/security.md) for the trust
  model, fork behavior and how to make the check required.

## Reviewing a diff locally

The engine runs entirely offline: no GitHub or AI credentials, no network access, and it never
executes code from the diff.

```sh
npm run build
git diff main...HEAD | node dist/cli/index.js review -       # Markdown report on stdout
node dist/cli/index.js review changes.diff --format json     # machine-readable report
node dist/cli/index.js review changes.diff --fail-on high    # opt-in CI gate
```

Input must be a git-style unified diff (`git diff` output). Example reports for the fixture diffs
are in [`fixtures/expected-reports/`](fixtures/expected-reports/).

| Option                    | Default    | Meaning                                                   |
| ------------------------- | ---------- | --------------------------------------------------------- |
| `--format markdown\|json` | `markdown` | Report format                                             |
| `--min-severity <level>`  | `low`      | Lowest severity listed; hidden findings are still counted |
| `--fail-on <level>`       | (none)     | Exit 1 if a listed finding is at or above this severity   |

**Exit codes:** `0` review completed (possibly with limitations) · `1` `--fail-on` threshold met ·
`2` usage error · `3` review failed (input rejected, or every analyzer failed). Reviews are
advisory by default: findings alone never fail the process.

**Review status** is always one of _Completed_, _Completed with limitations_ (an analyzer failed,
timed out or was skipped, a file or line exceeded a limit, or no file was eligible) or _Failed_.

### Built-in rules (TypeScript and JavaScript)

| Rule                                  | Severity | Flags                                                                    |
| ------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `builtin/hardcoded-secret`            | high     | AWS, GitHub, Slack, Stripe, Google, Anthropic, OpenAI keys; private keys |
| `builtin/tls-verification-disabled`   | high     | `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED = '0'`        |
| `builtin/shell-command-interpolation` | high     | `exec`/`execSync` with an interpolated template literal                  |
| `builtin/dynamic-code-execution`      | medium   | `eval`, `new Function`, string arguments to `setTimeout`/`setInterval`   |
| `builtin/focused-test`                | medium   | `.only`, `fit`, `fdescribe`                                              |
| `builtin/debugger-statement`          | low      | `debugger`                                                               |

Detected secrets are redacted in every output format.

### Optional AI review (hybrid mode)

`--mode hybrid` adds a local model reviewer, through [Ollama](https://ollama.com), to the
built-in rules. AI is **off by default**, and rules-only mode never makes a network request.

```sh
ollama pull qwen2.5-coder:3b           # ~1.9 GB; runs on CPU-only machines
node dist/cli/index.js review changes.diff --mode hybrid --ai-model qwen2.5-coder:3b
```

| Option                   | Default                  | Meaning                                               |
| ------------------------ | ------------------------ | ----------------------------------------------------- |
| `--ai-model <name>`      | (required)               | Ollama model; or set `PR_GUARDIAN_AI_MODEL`           |
| `--ai-endpoint <url>`    | `http://127.0.0.1:11434` | Ollama URL; or set `PR_GUARDIAN_AI_ENDPOINT`          |
| `--ai-timeout <seconds>` | `300`                    | Time limit for the model                              |
| `--allow-remote-ai`      | off                      | Required for any endpoint that is not on this machine |

How model output is kept honest:

- The model sees only the changed hunks, wrapped in delimiters with a random per-request nonce,
  and is told that repository text is data, not instructions. Prompt wording is **not** relied
  on as a security boundary; the checks below are enforced in code.
- Its reply must be JSON matching a strict shape (size-capped; one repair retry). Each finding
  must name a file the model was shown, and its evidence must quote an **added** line, or it is
  dropped. Line numbers are verified against the diff. `source` is always set to `ai` by
  PR Guardian, never by the model.
- If the model is unavailable, times out or replies with junk, the review continues with the
  rules and is marked _Completed with limitations_; it never looks like a clean AI review.

**Privacy.** Diff content is sent only to the configured endpoint. With the default local
endpoint it stays on this machine, as far as your Ollama setup keeps it there. Files containing a
detected credential are never sent; other credential-like values are redacted first.

**Quality.** Small local models running on a CPU are slow (minutes per review) and miss things or
produce weak findings. AI findings are model output that passed format and evidence checks,
not verified defects. The prompt is versioned (`review-v1`) and recorded in every report.

### Limits and exclusions

- Diffs over 1 MB or 300 files are rejected; files whose patch exceeds 100 KB, and added lines
  longer than 1,000 characters, are skipped and the review is marked _Completed with limitations_.
- Only `.ts .tsx .mts .cts .js .jsx .mjs .cjs` files are analyzed. `node_modules/`, `dist/`,
  `build/`, `coverage/`, `vendor/`, `.d.ts` and minified files are excluded.
- Files that commonly hold secrets (`.env*`, `*.pem`, `*.key`, SSH keys, `.npmrc`,
  `credentials.*`, …) are never analyzed or quoted.

### Known limitations

- Rules see one added line at a time. Issues that depend on surrounding code are not detected,
  and a pattern inside a string that spans several lines (e.g. a multi-line template literal) can
  be reported as a false positive.
- Only added lines are reviewed; removed code and unchanged context are not.
- Confidence values are fixed per rule and are heuristics, not calibrated probabilities.

## Scripts

| Script                  | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `npm run dev -- <args>` | Run the CLI from source with `tsx`                   |
| `npm run build`         | Compile `src/` to `dist/` with `tsc`                 |
| `npm run typecheck`     | Strict type-check of source, tests and config        |
| `npm run lint`          | ESLint, including architectural boundary rules       |
| `npm run format`        | Format with Prettier (`format:check` to verify only) |
| `npm test`              | Run the Vitest suite once (`test:watch` to watch)    |
| `npm run check`         | Everything CI runs, in order                         |

## Architecture

PR Guardian is a modular monolith that runs as a single Node.js process. Module boundaries are
enforced by lint rules and covered by tests. See [docs/architecture.md](docs/architecture.md).

## Planned

- Evaluation dataset and published methodology (Milestone 6)

## Security

Do not commit secrets. Secrets are supplied through environment variables or GitHub Secrets only.
The security model, permissions and known limitations are documented in
[docs/security.md](docs/security.md).

## License

_To be decided._
