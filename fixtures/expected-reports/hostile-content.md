## PR Guardian review

**Status:** ✅ Completed · **Mode:** rules-only · **Reviewer:** v0.1.0

1 finding (1 medium) in 1 analyzed file.

### Findings

#### Medium (1)

##### 1. Dynamic code execution

- **Location:** `src/handler.ts` line 4
- **Category:** security · **Confidence:** 0.70 · **Source:** static-analysis (`builtin/dynamic-code-execution`)

`eval`, `new Function` and string arguments to `setTimeout`/`setInterval` execute arbitrary code. If any part of the string can be influenced by input, this is a code-injection vector; it also defeats static analysis.

**Evidence**

````text
return eval(`<script>alert(1)</script> @admin [x](javascript:alert(1)) ``` + input);
````

**Suggested fix:** Replace with explicit logic (for example a lookup table or `JSON.parse` for data), or pass a function instead of a string to timers.

### Analyzers

| Analyzer | Status | Findings |
| --- | --- | --- |
| `builtin-rules` | succeeded | 1 |

### Files

Analyzed: 1 · Not analyzed: 0

### Limitations

- Only added lines are analyzed, line by line, with a fixed rule set; issues that depend on wider context are not detected.

---

<sub>PR Guardian is an automated assistant, not an authority. A review with no findings does not mean the code is correct or secure. Confidence values are heuristics, not calibrated probabilities. Generated 2026-01-01T00:00:00.000Z.</sub>
