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

| #   | Decision                                                                                                     | Rationale                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Node.js ≥ 22.12, Node 24 LTS by default; `engine-strict`                                                     | Node 20 reached end of life in April 2026, and current Vitest and ESLint releases require newer runtimes.                            |
| 2   | ESM only (`"type": "module"`, `NodeNext`)                                                                    | Native Node module system; no dual-package complexity.                                                                               |
| 3   | TypeScript 6.0.x, not 7.x                                                                                    | `typescript-eslint` (needed for type-aware lint) supports `typescript <6.1`. Revisit when it supports TS 7.                          |
| 4   | Plain `tsc` build, no bundler                                                                                | Enough for a CLI. How the GitHub Action is packaged (bundled JS action vs. workflow running the CLI) is decided in Milestone 4.      |
| 5   | Boundaries enforced by ESLint (`no-restricted-imports` with `allowTypeImports`) instead of separate packages | Real enforcement without a monorepo; ports (`ai/provider.ts`, `analyzers/analyzer.ts`) are importable by type only from domain code. |
| 6   | `tsx` for `npm run dev`                                                                                      | Runs TypeScript sources directly; dev-only dependency.                                                                               |
| 7   | CI: `contents: read`, `pull_request` trigger, SHA-pinned actions, `npm ci --ignore-scripts`, no secrets      | Least privilege; safe for fork PRs; dependency lifecycle scripts never run in CI.                                                    |
