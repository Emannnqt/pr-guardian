# PR Guardian

> Catch evidence-backed problems in pull requests before they reach production.

PR Guardian is a GitHub pull request reviewer that combines deterministic static analysis with
optional, schema-validated AI review. It is an assistant, not an authority: **a report with no
findings does not mean the code is correct or secure.**

> **Status: early development (Milestone 1 of 6, repository foundation).** The review engine,
> GitHub integration and AI adapter are not implemented yet. This README only describes what
> exists today; sections marked _planned_ will be filled in as features are built and verified.

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

- Local review of fixture diffs in rules-only mode, without credentials (Milestone 2)
- Optional AI review behind a provider-neutral interface (Milestone 3)
- GitHub Actions integration and job summary (Milestone 4)
- Inline comments with duplicate suppression (Milestone 5)
- Evaluation dataset and published methodology (Milestone 6)

## Security

Do not commit secrets. Secrets are supplied through environment variables or GitHub Secrets only.
A full security model will be documented in `docs/security.md` alongside the GitHub integration.

## License

_To be decided._
