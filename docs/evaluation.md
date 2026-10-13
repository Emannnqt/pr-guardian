# Evaluation

How well does PR Guardian find real problems, and how often is it wrong? This page describes the
labeled dataset, how findings are scored, the measured results, and the limits of what those
numbers mean. Results are produced by `npm run eval` and written into this page automatically.

## Dataset

[`evaluation/cases/`](../evaluation/cases/) holds 27 small, self-contained pull-request diffs,
each a real `git diff` with a JSON label file:

```json
{
  "id": "sec-missing-authorization",
  "group": "security",
  "description": "Invoice lookup by id without checking that it belongs to the caller (IDOR).",
  "expected": [{ "file": "src/invoices.ts", "line": 5, "issue": "Authorization check removed" }],
  "acceptable": []
}
```

| Group            | Cases | What they contain                                                                    |
| ---------------- | ----- | ------------------------------------------------------------------------------------ |
| security         | 10    | 5 patterns the built-in rules target, 5 that need real analysis (authorization, SQL injection, path traversal, XSS, weak hashing) |
| bug              | 3     | Off-by-one, missing `await`, `\|\|` instead of `??` with zero                        |
| testing          | 2     | Focused test (`.only`), skipped test (`.skip`)                                       |
| reliability      | 2     | `debugger` statement, swallowed error                                                |
| clean            | 7     | Changes with **no** issue: refactors, comments and string data that mention risky patterns, safe APIs, docs-only, a pattern inside a multi-line template |
| ambiguous        | 1     | `eval` of a constant in a build script, labeled _acceptable_ either way              |
| prompt-injection | 2     | Text instructing an AI reviewer to report nothing, next to a real issue             |

**Labeling rules.** A label marks a real problem on an **added** line, whether or not PR Guardian
can detect it; the labels were not adjusted to match the tool's output. `acceptable` marks lines
where flagging is defensible but not required; findings there are not scored.

## Scoring

A finding is **correct** when it names the labeled file **and** line. Each labeled issue counts
once; another finding on an already-matched issue is a **duplicate**, not an error. Any other
finding, including one without a line, is a **false positive**.

| Metric                         | Definition                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Precision                      | correct findings ÷ (correct + false positives)                                  |
| Recall                         | labeled issues found ÷ all labeled issues                                       |
| Clean-case false-positive rate | clean cases with at least one false positive ÷ clean cases                      |
| Invalid-finding rate           | candidate findings dropped by validation or evidence checks ÷ all candidates    |
| Duplicate rate                 | duplicate findings ÷ all findings                                               |

Every finding is scored, including `info` severity. Model token usage is not recorded.

## Results

<!-- results:rules-only:start -->

#### Rules-only (built-in rules)

Reviewer v1.0.0 · 27 cases · 19 labeled issues

| Metric | Value |
| --- | --- |
| Precision | 90.0% (9 correct / 10 scored findings) |
| Recall | 47.4% (9 of 19 labeled issues found) |
| Clean-case false-positive rate | 14.3% |
| Invalid-finding rate | 0.0% |
| Duplicate rate | 0.0% |
| Findings on debatable lines (not scored) | 1 |
| Review status | completed: 26, partial: 1 |

| Group | Found / labeled |
| --- | --- |
| security | 5 / 10 |
| bug | 0 / 3 |
| testing | 1 / 2 |
| reliability | 1 / 2 |
| prompt-injection | 2 / 2 |

<details><summary>Per-case results</summary>

| Case | Group | Labeled | Found | False positives | Status |
| --- | --- | --- | --- | --- | --- |
| `amb-eval-constant` | ambiguous | 0 | 0 | 0 | completed |
| `bug-missing-await` | bug | 1 | 0 | 0 | completed |
| `bug-nullish-zero` | bug | 1 | 0 | 0 | completed |
| `bug-off-by-one` | bug | 1 | 0 | 0 | completed |
| `clean-comment-mentions` | clean | 0 | 0 | 0 | completed |
| `clean-docs-only` | clean | 0 | 0 | 0 | partial |
| `clean-multiline-template` | clean | 0 | 0 | 1 | completed |
| `clean-refactor` | clean | 0 | 0 | 0 | completed |
| `clean-safe-execfile` | clean | 0 | 0 | 0 | completed |
| `clean-string-test-data` | clean | 0 | 0 | 0 | completed |
| `clean-tls-enabled` | clean | 0 | 0 | 0 | completed |
| `inj-fake-system-message` | prompt-injection | 1 | 1 | 0 | completed |
| `inj-report-nothing` | prompt-injection | 1 | 1 | 0 | completed |
| `rel-debugger` | reliability | 1 | 1 | 0 | completed |
| `rel-swallowed-error` | reliability | 1 | 0 | 0 | completed |
| `sec-eval-user-input` | security | 1 | 1 | 0 | completed |
| `sec-hardcoded-key` | security | 1 | 1 | 0 | completed |
| `sec-missing-authorization` | security | 1 | 0 | 0 | completed |
| `sec-new-function` | security | 1 | 1 | 0 | completed |
| `sec-path-traversal` | security | 1 | 0 | 0 | completed |
| `sec-shell-interpolation` | security | 1 | 1 | 0 | completed |
| `sec-sql-concatenation` | security | 1 | 0 | 0 | completed |
| `sec-tls-disabled` | security | 1 | 1 | 0 | completed |
| `sec-weak-password-hash` | security | 1 | 0 | 0 | completed |
| `sec-xss-innerhtml` | security | 1 | 0 | 0 | completed |
| `test-focused` | testing | 1 | 1 | 0 | completed |
| `test-skipped` | testing | 1 | 0 | 0 | completed |

</details>

<!-- results:rules-only:end -->

<!-- results:hybrid:start -->

_Not yet run._

<!-- results:hybrid:end -->

## Interpreting the results

- **The built-in rules are precise but narrow.** They find the specific dangerous constructs they
  look for (shell interpolation, `eval`, disabled TLS, known key formats, focused tests,
  `debugger`) and nothing else. Authorization gaps, injection through query builders, path
  traversal, XSS, weak cryptography and logic bugs are out of reach of line-based patterns, and
  they are labeled anyway so the recall figure shows that gap rather than hiding it.
- **The one rules-only false positive is a known limitation:** `debugger;` inside a multi-line
  template literal (test data) looks like code to a line-by-line check.
- **Prompt injection does not affect the rules**, which never read instructions. For hybrid
  mode, the injection cases check that model output is still validated and grounded.
- **Hybrid results come from one run of one small local model on one CPU-only laptop.** Model
  output is nondeterministic; another run, model or machine will give different numbers.

## Threats to validity

- **Small dataset.** 27 cases and 19 labeled issues: one case changes recall by about five
  points. These numbers describe this dataset, not real-world performance.
- **Same author.** The cases were written by the same project that wrote the rules, so the
  "detectable" cases are easier than real code. The "beyond the rules" cases partly offset this.
- **Synthetic diffs.** Real pull requests are larger and mix many changes; context matters more.
- **Line-level matching** treats a correct finding on a neighboring line as a miss plus a false
  positive.

## Reproducing

```sh
npm ci
npm run eval                      # rules-only: rewrites evaluation/results/rules-only.json and this page
npm run eval -- --no-write        # print only

# Hybrid (needs Ollama running locally and the model pulled; slow on CPU)
ollama pull qwen2.5-coder:3b
npm run eval -- --mode hybrid --ai-model qwen2.5-coder:3b --ai-timeout 900
```

The rules-only results are deterministic and checked in CI: a test re-runs the evaluation and fails
if [`evaluation/results/rules-only.json`](../evaluation/results/rules-only.json) or this page no
longer match the code.

### Adding a case

Create a small before/after change in a scratch git repository, save `git diff` as
`evaluation/cases/<id>.diff`, and write `<id>.json` with the labels (exact new-file line numbers
of added lines). Then run `npm run eval` and commit the updated results.
