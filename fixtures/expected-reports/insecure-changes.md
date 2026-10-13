## PR Guardian review

**Status:** ✅ Completed · **Mode:** rules-only · **Reviewer:** v1.0.0

6 findings (3 high, 2 medium, 1 low) in 4 analyzed files.

### Findings

#### High (3)

##### 1. Possible hardcoded credential (AWS access key ID)

- **Location:** `src/config.ts` line 4
- **Category:** security · **Confidence:** 0.90 · **Source:** static-analysis (`builtin/hardcoded-secret`)

This added line matches the format of a real credential. Secrets committed to source control are exposed to everyone with read access and remain in git history even after removal.

**Evidence**

```text
accessKeyId: '[REDACTED AWS access key ID]',
```

**Suggested fix:** Remove the value, load it from an environment variable or secret manager, and rotate the credential if it was ever valid.

##### 2. Shell command built with string interpolation

- **Location:** `src/deploy.ts` line 4
- **Category:** security · **Confidence:** 0.60 · **Source:** static-analysis (`builtin/shell-command-interpolation`)

`exec`/`execSync` run their argument through a shell. Interpolating values into the command string allows command injection if any value can be influenced by a user.

**Evidence**

```text
execSync(`git push origin ${branch}`);
```

**Suggested fix:** Use `execFile`/`spawn` with an argument array (no shell), or strictly validate every interpolated value.

##### 3. TLS certificate verification disabled

- **Location:** `src/http-client.ts` line 5
- **Category:** security · **Confidence:** 0.85 · **Source:** static-analysis (`builtin/tls-verification-disabled`)

Disabling certificate verification lets anyone on the network path impersonate the server and read or modify the traffic.

**Evidence**

```text
return new https.Agent({ keepAlive: true, rejectUnauthorized: false });
```

**Suggested fix:** Keep verification enabled. For private certificate authorities, pass the CA certificate (for example via the `ca` option or NODE_EXTRA_CA_CERTS) instead.

#### Medium (2)

##### 4. Dynamic code execution

- **Location:** `src/config.ts` line 9
- **Category:** security · **Confidence:** 0.70 · **Source:** static-analysis (`builtin/dynamic-code-execution`)

`eval`, `new Function` and string arguments to `setTimeout`/`setInterval` execute arbitrary code. If any part of the string can be influenced by input, this is a code-injection vector; it also defeats static analysis.

**Evidence**

```text
return eval(expression);
```

**Suggested fix:** Replace with explicit logic (for example a lookup table or `JSON.parse` for data), or pass a function instead of a string to timers.

##### 5. Focused test left in code

- **Location:** `tests/math.test.ts` line 4
- **Category:** testing · **Confidence:** 0.95 · **Source:** static-analysis (`builtin/focused-test`)

`.only` (or `fit`/`fdescribe`) makes the test runner skip every other test in the file or suite, so CI can pass while most tests silently do not run.

**Evidence**

```text
it.only('adds', () => {
```

**Suggested fix:** Remove `.only` (or rename `fit`/`fdescribe` back to `it`/`describe`) before merging.

#### Low (1)

##### 6. Debugger statement left in code

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

### Files

Analyzed: 4 · Not analyzed: 0

### Limitations

- Only added lines are analyzed, line by line, with a fixed rule set; issues that depend on wider context are not detected.

---

<sub>PR Guardian is an automated assistant, not an authority. A review with no findings does not mean the code is correct or secure. Confidence values are heuristics, not calibrated probabilities. Generated 2026-01-01T00:00:00.000Z.</sub>
