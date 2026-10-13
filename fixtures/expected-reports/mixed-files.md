## PR Guardian review

**Status:** ✅ Completed · **Mode:** rules-only · **Reviewer:** v0.1.0

1 finding (1 medium) in 2 analyzed files.

### Findings

#### Medium (1)

##### 1. Dynamic code execution

- **Location:** `src/café.ts` line 1
- **Category:** security · **Confidence:** 0.70 · **Source:** static-analysis (`builtin/dynamic-code-execution`)

`eval`, `new Function` and string arguments to `setTimeout`/`setInterval` execute arbitrary code. If any part of the string can be influenced by input, this is a code-injection vector; it also defeats static analysis.

**Evidence**

```text
export const value = eval("2");
```

**Suggested fix:** Replace with explicit logic (for example a lookup table or `JSON.parse` for data), or pass a function instead of a string to timers.

### Analyzers

| Analyzer | Status | Findings |
| --- | --- | --- |
| `builtin-rules` | succeeded | 1 |

### Files

Analyzed: 2 · Not analyzed: 6

<details><summary>Files not analyzed</summary>

- `.env.local`: may contain secrets; never analyzed
- `assets/logo.png`: binary file
- `lib/legacy.js`: file removed
- `node_modules/pkg/index.js`: excluded path
- `scripts/tool.py`: unsupported language
- `src/types.d.ts`: excluded path

</details>

### Limitations

- 1 file in unsupported languages was not analyzed. Only TypeScript and JavaScript are supported.
- Only added lines are analyzed, line by line, with a fixed rule set; issues that depend on wider context are not detected.

---

<sub>PR Guardian is an automated assistant, not an authority. A review with no findings does not mean the code is correct or secure. Confidence values are heuristics, not calibrated probabilities. Generated 2026-01-01T00:00:00.000Z.</sub>
