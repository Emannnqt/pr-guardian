# PR Guardian

> Catch evidence-backed problems in pull requests before they reach production.

PR Guardian is a GitHub pull request reviewer that combines deterministic static analysis with
optional, schema-validated AI review. It is an assistant, not an authority: **a report with no
findings does not mean the code is correct or secure.**

> **Status: early development (Milestone 2 of 6).** The local, rules-only review engine works.
> GitHub integration and the AI adapter are not implemented yet. This README only describes what
> exists today.

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

- Optional AI review behind a provider-neutral interface (Milestone 3)
- GitHub Actions integration and job summary (Milestone 4)
- Inline comments with duplicate suppression (Milestone 5)
- Evaluation dataset and published methodology (Milestone 6)

## Security

Do not commit secrets. Secrets are supplied through environment variables or GitHub Secrets only.
A full security model will be documented in `docs/security.md` alongside the GitHub integration.

## License

_To be decided._
