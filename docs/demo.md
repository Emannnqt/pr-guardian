# Demo

Two ways to see PR Guardian work: locally in a minute, or on a real pull request in about ten.
Everything here uses only repositories and code you control. The sample code is **intentionally
insecure** and labeled as such; never merge it.

## 1. Local (no GitHub, no credentials)

```sh
git clone https://github.com/Emannnqt/pr-guardian.git && cd pr-guardian
nvm use && npm ci && npm run build

# Review a fixture with six planted problems
node dist/cli/index.js review fixtures/diffs/insecure-changes.diff

# A change with hostile content: HTML, @mentions and fake instructions stay inert
node dist/cli/index.js review fixtures/diffs/hostile-content.diff

# Malformed input fails honestly (exit code 3), it is never a "clean" review
echo "not a diff" | node dist/cli/index.js review - ; echo "exit=$?"

# Machine-readable report and an opt-in CI gate
node dist/cli/index.js review fixtures/diffs/insecure-changes.diff --format json --fail-on high; echo "exit=$?"

# Reproduce the published evaluation numbers
npm run eval -- --no-write
```

Optional AI review (needs [Ollama](https://ollama.com); slow on CPU):

```sh
ollama pull qwen2.5-coder:3b
node dist/cli/index.js review fixtures/diffs/insecure-changes.diff --mode hybrid --ai-model qwen2.5-coder:3b
```

## 2. On a real pull request

1. **Create a repository you own** (or fork this one) and add `.github/workflows/pr-guardian.yml`:

   ```yaml
   name: PR Guardian
   on:
     pull_request:
       types: [opened, synchronize, reopened]
   permissions:
     contents: read
     pull-requests: write
   jobs:
     review:
       runs-on: ubuntu-latest
       timeout-minutes: 5
       steps:
         - uses: Emannnqt/pr-guardian@v1
           with:
             inline-comments: true
   ```

   Commit it to the default branch.

2. **Open a pull request with a labeled vulnerable change:**

   ```sh
   git checkout -b demo/vulnerable-example
   mkdir -p demo && cat > demo/insecure-example.ts <<'EOF'
   // INTENTIONALLY INSECURE DEMO FILE for PR Guardian. Do not merge.
   import { execSync } from 'node:child_process';
   import https from 'node:https';

   export function deploy(branch: string): void {
     execSync(`git push origin ${branch}`);
   }

   export const agent = new https.Agent({ rejectUnauthorized: false });
   EOF
   git add demo && git commit -m "Demo: intentionally insecure example (do not merge)"
   git push -u origin demo/vulnerable-example
   ```

   Open the pull request on GitHub.

3. **See the review.** Within seconds the **PR Guardian / Review** check finishes.
   - **Files changed** tab: inline comments on line 6 (shell command built from `branch`) and line 9
     (TLS verification disabled), each with an explanation and a suggested fix.
   - **Checks** tab → **PR Guardian** → **Summary**: the full report.

4. **Re-run it.** On the run page choose **Re-run jobs**. No new comments appear; the log shows
   `inline_posted=0 already_present=2`.

5. **Optional: make it blocking.** Add `fail-on: high` under `with:`, then mark the check as required
   in the branch protection rules. The same pull request now fails the check.

The live version of this walkthrough is [PR #1](https://github.com/Emannnqt/pr-guardian/pull/1) in
this repository.

## Video storyboard (about 3 minutes)

| #   | Shot                                                                  | Narration                                                                                                     |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | README header and the "Why" section                                   | "AI reviewers are easy to build and hard to trust. PR Guardian only reports what it can point to."            |
| 2   | Editor: `demo/insecure-example.ts`, the "do not merge" banner         | "Here's a deliberately insecure change: a shell command built from a branch name, and TLS checks turned off." |
| 3   | Pull request page, check running then green                           | "Opening the pull request triggers the Action. It reads the diff through the API and never runs the code."    |
| 4   | Files changed: the two inline comments                                | "Each finding lands on the exact line, says why it matters, and how to fix it."                               |
| 5   | Checks → Summary: status line, findings, analyzers, limitations       | "The summary says what was reviewed, what wasn't, and that no findings would not mean safe."                  |
| 6   | Re-run jobs; comments unchanged; log line `already_present=2`         | "Re-runs don't flood the PR. Each comment carries a fingerprint, and only PR Guardian's own comments count."  |
| 7   | Terminal: `hostile-content.diff` report showing escaped HTML/mentions | "Pull request text is untrusted: HTML, mentions and fake instructions stay inert."                            |
| 8   | `docs/evaluation.md` results table                                    | "On 27 labeled cases the rules are precise but narrow, and the evaluation shows exactly what they miss."      |
| 9   | `docs/security.md` permissions table                                  | "Read-only by default, write only for inline comments, and pull_request_target is refused."                   |
| 10  | Repo home: badges, license                                            | "It's MIT licensed, and the demo is reproducible from the docs."                                              |

## Screenshots

For the README and release, capture from the demo pull request:

- `docs/images/inline-comments.png`: the **Files changed** tab with both inline comments
- `docs/images/job-summary.png`: the **Summary** page of the PR Guardian run
