# Contributing

## Setup

```sh
nvm use        # Node 24 (see .nvmrc); 22.12+ also works
npm ci
npm run check  # typecheck, lint, format check, tests, CLI build, Action bundle
```

| Script                  | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `npm run dev -- <args>` | Run the CLI from source                                 |
| `npm test`              | Run the test suite (`npm run test:watch` to watch)      |
| `npm run lint`          | ESLint, including architecture-boundary rules           |
| `npm run format`        | Format with Prettier                                    |
| `npm run build`         | Compile the CLI to `dist/`                              |
| `npm run build:action`  | Rebuild the committed Action bundle in `dist-action/`   |
| `npm run eval`          | Run the labeled evaluation and update published results |

## Ground rules

- **Module boundaries are enforced by lint.** Core code (`src/core`, `src/diff`, `src/report`)
  must not import GitHub or AI code, spawn processes or read environment variables. Only
  `src/cli/` wires things together. See [docs/architecture.md](docs/architecture.md).
- **Everything from a pull request is untrusted.** Validate it, bound its size, escape it in output.
- **Commit the Action bundle.** If you change anything under `src/`, run `npm run build:action` and
  commit `dist-action/`; CI fails if the bundle is stale.

## Adding a rule

1. Add it to `src/analyzers/builtin-rules/rules.ts`. Match against `code` (strings and comments
   masked) unless the rule is about text that lives in strings, as secrets do.
2. Add hit and miss cases in `tests/unit/analyzers/builtin-rules.test.ts`, including a string or
   comment that mentions the pattern.
3. Add an evaluation case for it, run `npm run eval`, and commit the updated results. Golden
   reports may change: update them with `npx vitest run -u` and review the diff.

## Adding an evaluation case

Make a small before/after change in a scratch git repository, save `git diff` as
`evaluation/cases/<id>.diff`, and write `<id>.json` with labels: the file and **new-file line
number** of each real issue, whether or not PR Guardian can detect it. Then `npm run eval`. See
[docs/evaluation.md](docs/evaluation.md).

## Commits and security

Keep commits focused and describe why. Never commit secrets. Report vulnerabilities through a
private security advisory, not a public issue.
