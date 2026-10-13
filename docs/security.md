# Security model

PR Guardian reviews code from pull requests, which may be written by anyone, including
attackers. This document describes what it trusts, what it does not, and the limits of what it
can guarantee.

## Trust boundaries

| Input                                       | Trusted? | How it is handled                                                                            |
| ------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| Diff content, file paths, comments, strings | No       | Parsed with strict size limits and path validation; never executed; escaped in reports       |
| GitHub event payload and API responses      | No       | Schema-validated (only the fields used); unexpected shapes fail the review                   |
| Model output (hybrid mode, local only)      | No       | Size-capped, schema-validated, evidence-grounded against the diff, then validated again      |
| Action inputs and CLI flags                 | Partly   | Validated; limits can only be lowered; but see "Workflow files can be changed by a PR" below |
| PR Guardian's own code                      | Yes      | Reviewed source; the Action runs a committed bundle that CI checks against the source        |

## GitHub Action

### Trigger and forks

- Use the **`pull_request`** trigger. PR Guardian refuses to run on **`pull_request_target`**,
  because that trigger gives the pull request's workflow run access to secrets and a write
  token, and PR Guardian needs neither.
- Pull requests **from forks** run with a read-only token and no secrets. That is enough:
  PR Guardian only reads the pull request and writes the job summary, which needs no
  permission. The summary notes when a review came from a fork.
- GitHub asks a maintainer to approve workflow runs for first-time contributors (repository
  setting **Actions → Fork pull request workflows**). Keep that enabled.

### Permissions

| Permission            | Why                                                                      |
| --------------------- | ------------------------------------------------------------------------ |
| `contents: read`      | Check out the Action's own code when it is used as a local action (`./`) |
| `pull-requests: read` | Read the pull request and its changed files through the API              |

No write permissions are requested. The token is passed to Octokit only, is never logged, and
error messages are built from HTTP status codes, never from response bodies.

### No pull request code is executed

The Action does **not** check out the pull request. It reads each changed file's diff through
the GitHub REST API and analyzes it in memory. No scripts, package installs, build steps or
tests from the pull request are run. This repository's own workflow checks out the **base**
commit, so the reviewer that runs is the version already on the target branch.

### Workflow files can be changed by a pull request

With the `pull_request` trigger, GitHub runs the workflow file **as it exists in the pull
request**. A pull request can therefore edit `.github/workflows/pr-guardian.yml` to change
PR Guardian's inputs, pin a different version, or remove the step. No reviewer can prevent this
on its own. To make the review enforceable:

1. Protect the target branch and mark the PR Guardian check as **required**.
2. Add a `CODEOWNERS` entry such as `/.github/ @your-team` and require code-owner review, so
   changes to workflows need approval.
3. Pin the Action to a full commit SHA in your workflow (`uses: Emannnqt/pr-guardian@<sha>`).

This is also why configuration lives in Action inputs instead of a separate config file read
from the base branch: either way, a pull request that can edit the workflow can change the
review.

### Exit codes and branch protection

- The step **fails** when the review fails (input rejected, API error, or every analyzer
  failed), or when `fail-on` is set and met.
- It **passes with a warning** when the review completed with limitations.
- With no `fail-on`, findings never fail the step: reviews are advisory by default.

## Data handling

- Rules-only mode (the only mode in the Action) makes no network requests except to the GitHub
  API for the pull request being reviewed.
- Nothing is stored outside the runner: the JSON report is written to the runner's temporary
  directory and discarded with the job. There is no database or external service.
- Detected secrets are redacted from every report field. Files that commonly hold secrets
  (`.env*`, keys, `.npmrc`, …) are never analyzed or quoted.
- Hybrid (AI) mode is available only in the local CLI. It sends diff content to the configured
  Ollama endpoint, which must be on the same machine unless `--allow-remote-ai` is given. Files
  containing a detected secret are never sent.

## Known limitations

- A clean report is not a security guarantee: the built-in rules are line-based and narrow.
- Very large files (no diff available from GitHub) are skipped, and the review is marked as
  completed with limitations.
- Report text from pull requests is escaped (HTML, links, mentions, autolinks, bidirectional
  characters), but GitHub's Markdown renderer is outside PR Guardian's control.
- Prompt-injection resistance in hybrid mode relies on code-level checks (delimiters, schema,
  evidence grounding), not on the prompt; a model can still miss real issues.

## Reporting a vulnerability

Please open a private security advisory on the repository rather than a public issue.
