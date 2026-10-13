# PR Guardian

## Product Requirements, Technical Design, and Implementation Plan

**Document type:** Project specification and build instructions\
**Version:** 1.1\
**Status:** Initial V1 plan\
**Primary goal:** Build a credible, secure, portfolio-quality GitHub
pull request reviewer.

------------------------------------------------------------------------

## 1. Project Overview

### 1.1 Product summary

PR Guardian is a developer tool that reviews GitHub pull requests and
reports actionable potential issues before code is merged. It combines
deterministic tools---such as linters and static analysis---with
optional AI-assisted contextual review.

It should help developers identify: - Potential bugs and regressions. -
Security and authorization risks. - Missing or inadequate tests. - Risky
changes that deserve human attention. - Clear, evidence-backed
opportunities to improve the code.

PR Guardian is an assistant, not an authority. It must not claim that
code is safe simply because no findings were produced, and it must not
present speculative findings as confirmed defects.

### 1.2 Target users

-   Individual developers maintaining personal or open-source
    repositories.
-   Small engineering teams that want an additional review layer.
-   Developers learning how to improve code quality and security.
-   Hiring teams evaluating the project's engineering quality.

### 1.3 Product positioning

**Value proposition:** "Catch evidence-backed problems in pull requests
before they reach production."

The differentiator should be trustworthy findings, clear evidence, low
noise, safe operation, and transparent limitations---not simply adding
an LLM to a GitHub workflow.

### 1.4 V1 scope

V1 is a GitHub Actions-based tool. It should be possible to run the
review engine locally on fixture diffs without GitHub credentials. Once
the local engine is reliable, connect it to GitHub and publish a pull
request summary.

A separate web dashboard, hosted service, accounts system, billing, and
database are explicitly out of scope for V1.

------------------------------------------------------------------------

## 2. Goals and Non-Goals

### 2.1 Goals

1.  Review changes in a pull request, not blindly analyze an entire
    repository.
2.  Combine deterministic static-analysis results with contextual AI
    review.
3.  Return structured, validated findings.
4.  Include evidence tied to the changed code.
5.  Publish a readable GitHub Actions summary and, when safely
    supported, inline review comments.
6.  Run automated unit and integration tests.
7.  Operate with minimal GitHub permissions and protect secrets.
8.  Measure usefulness and false-positive rates with a repeatable
    evaluation dataset.
9.  Make the project straightforward for another developer to install,
    run, understand, and contribute to.

### 2.2 Non-goals for V1

-   Automatically committing fixes or pushing branches.
-   Automatically approving, rejecting, or merging pull requests.
-   Executing code from pull requests.
-   Treating AI output as proof of a vulnerability.
-   Supporting every programming language equally from day one.
-   Building a complete commercial SaaS dashboard.
-   Storing source code or pull request data in a remote database.
-   Replacing human code review, tests, linters, or dedicated security
    tools.

------------------------------------------------------------------------

## 3. Recommended Technology Stack

Use current stable versions compatible with the development environment.
Pin dependencies and commit the lockfile. Verify package names,
compatibility, and current GitHub API behavior during implementation
rather than assuming this document guarantees a particular release.

  -----------------------------------------------------------------------
  Area                    Recommended choice      Purpose
  ----------------------- ----------------------- -----------------------
  Language                TypeScript              Typed core
                                                  implementation

  Runtime                 Node.js LTS             Run the CLI and GitHub
                                                  Action

  Package manager         npm                     Dependencies and
                                                  reproducible lockfile

  GitHub API              Octokit                 Read pull request
                                                  metadata and publish
                                                  findings

  GitHub automation       GitHub Actions          Run on pull request
                                                  events

  Schema validation       Zod or an equivalent    Validate untrusted
                          schema validator        model output and
                                                  configuration

  Testing                 Vitest                  Unit and integration
                                                  tests

  Linting/formatting      ESLint and Prettier     Enforce consistent code
                                                  quality

  Static analysis         ESLint plus Semgrep or  Deterministic checks
                          suitable                
                          language-specific tools 

  AI integration          Provider-neutral        Contextual analysis
                          interface; optional     
                          local Ollama adapter    

  CI                      GitHub Actions          Run lint, typecheck,
                                                  tests, and build

  Persistence             None in V1              Avoid unnecessary
                                                  infrastructure
  -----------------------------------------------------------------------

### 3.1 Initial language support

Start with TypeScript and JavaScript. Design the analyzer interfaces so
other languages can be added later. Do not claim support for a language
until its deterministic tooling, diff handling, and evaluation fixtures
have been tested.

### 3.2 AI execution modes

Support a rules-only mode first, then add a hybrid mode: -
**Rules-only:** static-analysis tools produce findings; no model is
needed. - **Hybrid:** static-analysis findings plus AI review of
bounded, relevant diffs. - **Local AI:** hybrid mode using a local model
endpoint such as Ollama.

Keep the model provider behind an interface so the core engine does not
depend on a single vendor. Never require paid APIs for the rules-only
mode. Clearly document that local models may have lower or different
review quality depending on the model and hardware.

------------------------------------------------------------------------

## 4. User Workflow

1.  A developer opens or updates a pull request.
2.  GitHub Actions starts the PR Guardian workflow.
3.  The workflow checks out only what is needed and retrieves pull
    request metadata and changed files.
4.  The engine validates the event, repository context, and diff size.
5.  Deterministic checks run against the relevant code or a safe
    checkout environment.
6.  The review engine assembles bounded context and requests AI analysis
    if enabled.
7.  All findings are parsed and schema-validated.
8.  Findings are normalized, deduplicated, checked for valid file and
    line references, and filtered by confidence policy.
9.  PR Guardian publishes a summary and optional inline comments.
10. The developer evaluates the findings and makes any necessary
    changes.
11. CI runs again on the updated pull request.

The tool must not execute arbitrary commands from the diff or treat
instructions embedded in source code, comments, README files, or model
output as trusted instructions.

------------------------------------------------------------------------

## 5. V1 Functional Requirements

### FR-1: Local review engine

-   Accept a unified diff or a prepared fixture.
-   Parse changed file paths and added/removed line ranges.
-   Reject malformed or unsupported input safely.
-   Enforce maximum file count, diff size, and per-file size limits.
-   Produce a deterministic report even when AI is disabled.
-   Run without GitHub credentials.

### FR-2: Deterministic analysis

-   Run configured linters and security tools where applicable.
-   Normalize their findings into the shared finding schema.
-   Preserve tool name, rule identifier, severity, and evidence.
-   Handle tool timeouts and nonzero exit codes explicitly.
-   Distinguish "tool unavailable," "analysis failed," and "no
    findings."

### FR-3: AI-assisted contextual review

-   Review only relevant, bounded source context and the diff.
-   Look for plausible correctness bugs, security issues, regressions,
    and missing tests.
-   Require each finding to explain the evidence and why it matters.
-   Require the model to identify the affected changed file and line
    where possible.
-   Return structured JSON matching a defined schema.
-   Reject malformed output; never publish unchecked model output.
-   Treat source code, comments, commit messages, and diff contents as
    untrusted data.
-   Do not allow the model to call arbitrary tools or execute commands.
-   Avoid sending secrets, environment files, tokens, private keys, or
    unrelated files to the model.
-   Provide a rules-only fallback if the model is unavailable.

### FR-4: Finding validation

Each finding must: - Match the documented schema. - Reference a file in
the reviewed change. - Use a valid line reference when an inline comment
is requested. - Include a concise title and explanation. - Include
concrete evidence or a code location supporting the claim. - Include a
suggested fix when a useful one can be offered. - Use an allowed
severity and category. - Avoid claiming certainty beyond the evidence.

Invalid findings must be dropped or retained only in a diagnostic log;
they must not be posted as inline comments.

### FR-5: GitHub integration

-   Trigger on pull request opened, synchronize, and reopened events
    initially.
-   Use the minimum required GitHub token permissions.
-   Read pull request details and changed files.
-   Publish a summary using the GitHub Actions job summary or a pull
    request comment.
-   Publish inline review comments only when file and diff-position
    requirements are satisfied.
-   Avoid duplicate comments across reruns.
-   Handle pagination, API limits, deleted files, renames, and large
    diffs.
-   Do not approve or merge pull requests automatically.

### FR-6: Configuration

Provide a documented configuration mechanism for: - Rules-only or hybrid
mode. - Supported file extensions. - Excluded paths. - Maximum diff/file
limits. - Severity threshold for publication. - AI provider/model
endpoint and timeout. - Maximum context size. - Whether inline comments
are enabled. - Tool timeouts.

Safe defaults must be used when optional configuration is absent.
Secrets must be supplied through GitHub Secrets or environment
variables, never committed to the repository.

### FR-7: Reporting

A report should include: - Review status: completed, completed with
limitations, or failed. - Summary of files or changes analyzed. -
Findings grouped by severity. - File and line references. - Explanation,
evidence, and suggested fix. - Deterministic tools used and any tools
that failed or were skipped. - Model/provider status when applicable. -
A clear statement that no findings does not guarantee correctness or
security.

### FR-8: Observability and errors

-   Use structured logs without leaking secrets or source code
    unnecessarily.
-   Include a run identifier where available.
-   Report API errors, timeouts, schema failures, and tool failures
    clearly.
-   Do not silently treat analysis failure as a clean review.
-   Apply retry logic only to appropriate transient failures.
-   Bound retries and execution time.

------------------------------------------------------------------------

## 6. Finding Data Model

Use a validated shared type. A suggested conceptual schema:

``` ts
type Severity = "critical" | "high" | "medium" | "low" | "info";

type FindingCategory =
  | "bug"
  | "security"
  | "performance"
  | "testing"
  | "maintainability"
  | "reliability";

interface ReviewFinding {
  id: string;
  title: string;
  severity: Severity;
  category: FindingCategory;
  confidence: number; // 0..1, treated as a heuristic, not calibrated probability
  filePath: string;
  startLine?: number;
  endLine?: number;
  explanation: string;
  evidence: string;
  suggestedFix?: string;
  source: "static-analysis" | "ai";
  ruleId?: string;
}
```

Implementation requirements: - Validate at runtime, not only with
TypeScript types. - Set limits on every string and array. - Reject
invalid confidence values and line numbers. - Normalize paths and
prevent path traversal. - Never trust a model-generated ID as the only
deduplication key. - Generate stable internal identifiers from
normalized finding attributes. - Keep the confidence field explicitly
documented as a heuristic unless it has been calibrated against a
labeled dataset.

------------------------------------------------------------------------

## 7. Suggested Repository Structure

Adjust as implementation reveals real needs, but keep responsibilities
separate.

``` text
pr-guardian/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── pr-guardian.yml
├── docs/
│   ├── architecture.md
│   ├── security.md
│   ├── configuration.md
│   └── evaluation.md
├── fixtures/
│   ├── diffs/
│   └── expected-findings/
├── src/
│   ├── cli/
│   │   └── index.ts
│   ├── core/
│   │   ├── review.ts
│   │   ├── types.ts
│   │   ├── schema.ts
│   │   ├── normalize-findings.ts
│   │   └── deduplicate.ts
│   ├── diff/
│   │   ├── parse-diff.ts
│   │   └── limits.ts
│   ├── analyzers/
│   │   ├── analyzer.ts
│   │   ├── eslint.ts
│   │   └── semgrep.ts
│   ├── ai/
│   │   ├── provider.ts
│   │   ├── prompt.ts
│   │   └── review-diff.ts
│   ├── github/
│   │   ├── client.ts
│   │   ├── pull-request.ts
│   │   ├── publish-summary.ts
│   │   └── publish-inline-comments.ts
│   ├── report/
│   │   └── markdown.ts
│   └── config/
│       └── load-config.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── security/
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── eslint.config.js
├── vitest.config.ts
├── README.md
└── LICENSE
```

Do not create every file as an empty placeholder at the start. Build
only the structure needed for the current milestone.

------------------------------------------------------------------------

## 8. Architecture and Module Responsibilities

### 8.1 Core review orchestrator

The core orchestrator accepts a review input, invokes configured
analyzers, optionally invokes an AI provider, normalizes and validates
results, deduplicates findings, and returns a report object.

It must not depend directly on GitHub API objects. This keeps the engine
testable locally.

### 8.2 Analyzer interface

Create a common interface for deterministic tools. An analyzer should
receive a bounded input and return normalized findings plus execution
metadata, such as success, failure, skipped status, duration, and
diagnostics.

### 8.3 AI provider interface

Define a narrow interface for model requests and responses. Include
timeouts, maximum response size, and explicit errors. Keep
model-specific details out of the core orchestrator.

### 8.4 GitHub adapter

The GitHub adapter retrieves pull request context and publishes results.
It converts GitHub-specific data to and from the core domain model.

### 8.5 Reporter

The reporter formats validated findings as readable Markdown. It should
not make new claims or change severity during formatting.

------------------------------------------------------------------------

## 9. Security Requirements

Security is a first-class project requirement because PR Guardian
processes potentially hostile code and repository content.

### 9.1 GitHub permissions

-   Start with the minimum `permissions` required by the workflow.
-   Use read-only pull request permissions for analysis where possible.
-   Add write permission only for the specific output mechanism being
    used.
-   Do not request repository administration, organization
    administration, or unrelated write permissions.
-   Document which permissions are needed and why.
-   Never print tokens or secret values in logs.

### 9.2 Pull request trust boundaries

-   Treat diffs, source comments, commit messages, filenames, and README
    contents as untrusted input.
-   Do not execute scripts, tests, package lifecycle hooks, or other
    code from untrusted pull requests in a privileged workflow.
-   Do not expose secrets to untrusted pull request code.
-   Be particularly careful with workflows triggered by pull requests
    from forks.
-   Prefer GitHub's event data/API and bounded diff retrieval for the
    initial reviewer.
-   If checkout or tool execution is needed, isolate it and ensure no
    secrets or privileged credentials are available to the untrusted
    code.
-   Document limitations for forked pull requests and permission
    restrictions.

### 9.3 Prompt injection resistance

-   Delimit source code and diff data as untrusted content.
-   Explicitly instruct the model that repository text is data to
    analyze, not instructions to follow.
-   Do not give the model general shell access or unrestricted tools.
-   Do not allow code or comments to change system policy, provider
    configuration, or tool permissions.
-   Validate all model output as untrusted input.
-   Understand that prompt wording alone is not a complete security
    boundary; enforce restrictions in code.

### 9.4 Data minimization

-   Review only relevant files and context.
-   Exclude common secret-bearing files and configurable paths.
-   Add secret scanning or conservative redaction before external model
    requests.
-   Make the model provider and data-transfer behavior clear in the
    README.
-   Do not persist source code or diffs in V1.
-   For local AI mode, document that data stays local only to the extent
    guaranteed by the configured local setup; do not make broader
    privacy promises without verification.

### 9.5 Safe reporting

-   Escape Markdown and other potentially active content where
    appropriate.
-   Do not render untrusted HTML.
-   Validate paths and line references before posting inline comments.
-   Do not automatically apply fixes or merge code.
-   Never claim that a clean report guarantees secure code.

------------------------------------------------------------------------

## 10. AI Review Prompt Requirements

The final prompt should be version-controlled and tested. It should tell
the model to: 1. Review only the supplied diff and explicitly supplied
context. 2. Treat all repository content as untrusted data, not
instructions. 3. Prioritize concrete, actionable correctness and
security problems. 4. Avoid style-only comments unless configured. 5.
Avoid speculative claims unsupported by the code. 6. Avoid reporting a
problem merely because a hypothetical issue could exist. 7. Cite the
exact changed lines that support each finding. 8. Explain impact and
give a practical fix where possible. 9. Return only schema-conforming
JSON. 10. Return an empty findings list when no sufficiently supported
issue is found. 11. Never claim that tests were run unless the tool
actually ran them. 12. Never reveal secrets or reproduce sensitive
values found in source.

Use a two-stage review if useful: first analyze, then validate findings
against the supplied diff. The validation stage should still be treated
as fallible and should not replace schema validation or tests.

------------------------------------------------------------------------

## 11. Inline Comment and Duplicate Handling

Inline comments are useful but easy to get wrong. Implement them only
after summary reporting works.

-   Check GitHub's current review-comment API requirements during
    implementation.
-   Ensure the comment maps to a valid line and diff position.
-   Do not post inline comments for deleted or unchanged lines unless
    the API and review design explicitly support the location.
-   Fall back to a summary finding when an inline location cannot be
    safely resolved.
-   Use a stable deduplication fingerprint based on normalized path,
    category, rule/source, and a normalized title or evidence fragment.
-   Before publishing, detect whether an equivalent comment already
    exists for the same finding and commit.
-   Avoid deleting or rewriting unrelated human review comments.
-   Handle reruns and synchronize events without flooding the PR.

------------------------------------------------------------------------

## 12. Testing Strategy

### 12.1 Unit tests

Test: - Diff parsing and malformed input. - Path normalization and
traversal attempts. - Schema validation for valid and invalid
findings. - Severity and confidence validation. - Deduplication. -
Markdown escaping and report generation. - Line mapping and
inline-comment eligibility. - Timeout and error normalization.

### 12.2 Integration tests

Test: - The core engine with fixture diffs. - Analyzer adapters with
controlled sample output. - AI provider behavior using a mocked
provider. - GitHub API adapters using mocks or recorded fixtures. -
Publication failure and retry handling. - Rules-only mode when AI is
unavailable. - Large diff and unsupported-file behavior.

Do not make ordinary unit tests depend on a live model API or live
GitHub repository.

### 12.3 Security tests

Include cases for: - Prompt injection inside comments and source
strings. - Secret-like values in diffs. - Malicious or unusual file
paths. - Oversized diffs and model responses. - Invalid JSON and
schema-violating model output. - HTML/Markdown injection in findings. -
Pull request events from forks. - Missing permissions and API
authorization failures. - Attempts to make the reviewer execute
arbitrary commands.

### 12.4 Evaluation dataset

Create a small, version-controlled dataset containing: - Known
bug-introducing diffs. - Security-relevant changes. - Changes that
should not produce a finding. - Missing-test examples. - Difficult
ambiguous examples. - Prompt-injection examples.

For each fixture, record expected findings and acceptable behavior.
Measure: - Precision: how many reported findings are useful and
correct. - Recall on the labeled fixture set: how many known issues are
detected. - False-positive rate. - Invalid finding rate. - Duplicate
finding rate. - Runtime and token/model cost where applicable.

Do not market a high accuracy percentage without explaining the dataset,
methodology, and limitations.

------------------------------------------------------------------------

## 13. Definition of Done for V1

V1 is ready for a portfolio release when all of the following are true:

-   [ ] A developer can install dependencies from a clean clone.
-   [ ] The local CLI can analyze fixture diffs without GitHub
    credentials.
-   [ ] Rules-only mode works without an AI model.
-   [ ] Findings are validated at runtime against a schema.
-   [ ] The engine rejects oversized or malformed inputs safely.
-   [ ] Reports identify the affected file and line when known.
-   [ ] GitHub Actions can analyze a test pull request in a repository
    the developer controls.
-   [ ] A summary is published successfully.
-   [ ] Inline comments are posted only when locations are valid.
-   [ ] Rerunning a workflow does not create uncontrolled duplicate
    comments.
-   [ ] Failures are reported honestly and are not represented as a
    clean review.
-   [ ] Unit and integration tests run in CI.
-   [ ] Secrets are not committed or printed in logs.
-   [ ] Fork PR and permission behavior is documented.
-   [ ] README includes setup, configuration, usage, security
    limitations, screenshots or sample output, and architecture.
-   [ ] Evaluation fixtures and results are included.

------------------------------------------------------------------------

## 14. Development Milestones

### Milestone 1 --- Repository foundation

Deliver: - TypeScript/Node.js project setup. - Package scripts for dev,
build, test, lint, and typecheck. - Strict TypeScript configuration. -
Vitest configuration. - CI workflow. - README skeleton.

Acceptance criteria: - Clean install succeeds. - Typecheck, lint, tests,
and build run locally and in CI.

### Milestone 2 --- Local deterministic review engine

Deliver: - Shared finding types and runtime schema. - Diff input format
and limits. - One deterministic analyzer integration or a carefully
scoped first rule set. - Markdown report generator. - Fixture-based
tests.

Acceptance criteria: - A sample diff produces a stable report. - Invalid
input fails safely. - Rules-only mode needs no credentials.

### Milestone 3 --- AI adapter

Deliver: - Provider interface. - Prompt file and versioning. - Mocked
provider tests. - Optional local Ollama adapter or another clearly
documented provider. - Response validation and size limits.

Acceptance criteria: - The AI can be disabled. - Invalid output never
reaches GitHub. - Model failure does not masquerade as successful
analysis.

### Milestone 4 --- GitHub pull request integration

Deliver: - Workflow triggers. - Minimal permissions. - PR metadata and
diff retrieval. - Job summary publication. - Error and timeout handling.

Acceptance criteria: - A test PR receives a summary. - Fork and
permission limitations are handled safely.

### Milestone 5 --- Inline comments and deduplication

Deliver: - Safe line mapping. - Inline comment publishing. - Stable
fingerprints. - Rerun handling.

Acceptance criteria: - Only valid changed-line comments are posted. -
Reruns do not flood the pull request.

### Milestone 6 --- Evaluation and portfolio release

Deliver: - Labeled fixtures. - Evaluation script and metrics. -
Architecture and security documentation. - Screenshots/sample report. -
Demo video and release notes.

Acceptance criteria: - Another developer can reproduce the demo from the
documentation. - Known limitations and evaluation methodology are
clearly disclosed.

------------------------------------------------------------------------

## 15. Portfolio Presentation

The GitHub repository should make the engineering quality visible
quickly.

### README structure

1.  Product description and short demo.
2.  Problem statement and design goals.
3.  Example review report.
4.  Architecture diagram.
5.  Supported languages and analysis modes.
6.  Quick start for local fixture review.
7.  GitHub Actions installation and permissions.
8.  AI provider setup and privacy implications.
9.  Security model and known limitations.
10. Testing and evaluation results.
11. Roadmap.
12. Contribution instructions and license.

### Demo scenario

Create a test repository with a deliberately vulnerable or incorrect
example, such as an authorization check missing from a resource lookup.
Open a pull request and show PR Guardian: - Detecting or flagging the
issue. - Citing the changed file and relevant line. - Explaining the
risk without overstating certainty. - Suggesting a fix. - Avoiding a
duplicate comment on rerun.

Use only a repository and sample code you control. Clearly label
intentionally vulnerable examples.

### Resume framing

After the project is implemented and measured, a resume bullet could
follow this pattern:

"Built PR Guardian, a TypeScript-based GitHub pull request reviewer
combining static analysis and structured AI findings, with schema
validation, least-privilege workflows, duplicate suppression, and
fixture-based evaluation."

Only claim features that have actually been implemented and verified.
Add measured results only after running a documented evaluation.

------------------------------------------------------------------------

## 16. System Design and Architecture

This section defines the intended architecture, module boundaries, runtime flow, and the path from a local CLI to a possible hosted service. Implement the simplest version that satisfies V1; do not build future infrastructure prematurely.

### 16.1 Architecture principles

1. **Core-first:** review logic must run locally without GitHub credentials.
2. **Ports and adapters:** core review logic depends on interfaces, not Octokit, a particular AI provider, or a particular static-analysis executable.
3. **Deterministic before probabilistic:** use static-analysis findings as reproducible signals; use AI for contextual analysis and explanations.
4. **Validate every boundary:** diffs, configuration, tool output, model output, and GitHub API responses are untrusted inputs.
5. **Least privilege:** the workflow receives only the permissions it needs for the selected publishing mode.
6. **Fail honestly:** analysis failures and partial results must be distinguishable from a completed review with no findings.
7. **Bounded work:** cap file count, diff size, context size, output size, runtime, and retries.
8. **No unnecessary infrastructure in V1:** no hosted API, database, queue, or dashboard until a demonstrated requirement calls for one.

### 16.2 Logical component diagram

```mermaid
flowchart TD
    A[GitHub Pull Request Event] --> B[GitHub Actions Adapter]
    B --> C[PR Context Loader]
    C --> D[Input Validation and Diff Limits]
    D --> E[Review Orchestrator]
    E --> F[Static Analyzer Adapter]
    E --> G[AI Provider Adapter - optional]
    F --> H[Finding Normalizer]
    G --> H
    H --> I[Schema and Evidence Validator]
    I --> J[Deduplication and Policy Filter]
    J --> K[Review Report]
    K --> L[GitHub Summary Publisher]
    K --> M[Inline Comment Publisher - optional]
```

The diagram represents logical responsibilities, not necessarily separate deployable services. In V1, most components should run in a single Node.js process inside a GitHub Actions job.

### 16.3 Runtime deployment view

```mermaid
flowchart LR
    DEV[Developer] -->|opens or updates PR| GH[GitHub]
    GH -->|workflow event| RUNNER[GitHub-hosted Runner]
    RUNNER --> CORE[PR Guardian Node.js Process]
    CORE --> TOOLS[Static Analysis Tools]
    CORE -. optional bounded request .-> MODEL[Configured AI Provider]
    CORE -->|least-privilege token| API[GitHub API]
    API -->|summary and valid review comments| GH
```

V1 does not need a continuously running server. GitHub Actions provides event triggering and execution. This reduces operational overhead and keeps the first version easier to demonstrate.

### 16.4 Core module boundaries

| Module | Responsibility | Must not own |
|---|---|---|
| `core/review.ts` | Orchestrate review stages and produce a domain report | GitHub API calls or provider-specific SDK calls |
| `core/types.ts` and `core/schema.ts` | Define domain types and runtime validation | Network access or analysis policy hidden in type definitions |
| `diff/` | Parse diffs, map changed lines, enforce input limits | Running arbitrary repository code |
| `analyzers/` | Adapt deterministic tools into normalized findings | Publishing comments directly to GitHub |
| `ai/` | Build bounded requests, call a configured model, parse its response | Shell access, Git writes, or unrestricted tool execution |
| `core/normalize-findings.ts` | Normalize titles, paths, severity, and metadata | Inventing evidence not present in inputs |
| `core/deduplicate.ts` | Collapse equivalent findings using stable fingerprints | Deleting human comments or changing source code |
| `report/` | Render validated findings and run status into Markdown | Changing finding meaning or severity |
| `github/` | Translate GitHub events/data and publish results | Containing the core review logic |
| `config/` | Parse configuration and environment values | Logging secret values |

Keep these as module boundaries, not separate services. Extract a service only if a concrete scale or isolation need appears.

### 16.5 Core data flow

1. **Receive event:** the GitHub adapter validates event type, repository identity, pull request number, and head/base SHA values.
2. **Load context:** retrieve PR metadata and changed-file metadata. Fetch bounded diffs for eligible files. Handle pagination and API failures.
3. **Validate and bound:** reject malformed paths, unsupported file types, excessive file counts, oversized patches, and requests that exceed configured limits. Exclusions must be applied before model context is assembled.
4. **Analyze deterministically:** invoke configured analyzers through adapters. Record each analyzer's status and diagnostics independently.
5. **Assemble AI context:** if AI is enabled, include only the relevant diff and the smallest necessary context. Apply secret checks/redaction and explicit size limits. Treat all repository content as untrusted data.
6. **Parse model output:** enforce a strict schema and maximum output size. Do not publish free-form model prose as a finding.
7. **Validate findings:** ensure the file belongs to the reviewed change, lines are valid, evidence supports the finding, and all fields meet length and value constraints.
8. **Normalize and deduplicate:** create stable fingerprints, collapse equivalent findings, and apply publication policy without silently erasing high-impact deterministic results.
9. **Create report:** report status, tools used, limitations, findings, and any partial failures.
10. **Publish:** write the job summary first. Publish inline comments only when GitHub's current API rules and the diff mapping permit it. Use an idempotency strategy to avoid repeated comments.
11. **Exit appropriately:** a completed review with zero findings is different from a failed or partial review. Choose and document CI exit-code policy; do not fail a PR merely because an AI opinion is low confidence unless configured to do so.

### 16.6 Domain model

Use explicit domain objects rather than passing raw GitHub or provider responses through the entire application.

Suggested conceptual types:

```ts
interface ReviewInput {
  repository: { owner: string; name: string };
  pullRequestNumber?: number;
  baseSha?: string;
  headSha?: string;
  files: ReviewFile[];
  mode: "rules-only" | "hybrid";
}

interface ReviewFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  patch?: string;
  language?: string;
}

interface AnalyzerResult {
  analyzer: string;
  status: "succeeded" | "failed" | "skipped" | "timed-out";
  findings: ReviewFinding[];
  durationMs: number;
  diagnostics?: string[];
}

interface ReviewReport {
  status: "completed" | "partial" | "failed";
  findings: ReviewFinding[];
  analyzers: AnalyzerResult[];
  limitations: string[];
  generatedAt: string;
}
```

These are design examples. Align them with the actual implementation and avoid duplicating fields without a clear need. Keep raw provider/API types at adapter boundaries.

### 16.7 Failure and fallback policy

| Failure | Required behavior |
|---|---|
| AI provider unavailable | Continue in rules-only mode when possible; mark report partial if AI was expected |
| Static analyzer unavailable | Mark that analyzer skipped/failed; do not imply it ran |
| Diff too large | Review eligible bounded files or stop with a clear partial/failed status according to policy |
| Invalid model JSON | Reject the response; optionally retry once with a bounded repair request, then report failure |
| Finding references unknown file | Drop it from publication and record a diagnostic |
| Finding references invalid inline line | Keep it in the summary if otherwise valid; do not post inline |
| GitHub publishing failure | Preserve a clear workflow error and available job summary; use bounded retry for transient errors |
| Rate limit | Respect GitHub/provider retry guidance and stop after a bounded period |
| Secret detection/redaction failure | Do not send the affected context to an external model |

### 16.8 Idempotency and duplicate prevention

GitHub workflows may rerun or execute again for each new commit. Make publishing idempotent as far as practical:

- Derive a review run identity from repository, PR number, head SHA, and reviewer version/configuration.
- Derive a finding fingerprint from normalized file path, category, source/rule, title, and relevant evidence.
- Prefer updating a PR Guardian-owned summary comment when feasible rather than posting a new summary on every run.
- Mark bot-authored comments clearly and never modify unrelated human comments.
- Recheck comment state before publishing where API behavior permits it.
- Document that a changed commit SHA may legitimately produce a new review.

### 16.9 CI and exit-code policy

Use separate concepts for **review status** and **policy outcome**:

- Review status answers whether analysis completed.
- Policy outcome answers whether findings exceed a configured threshold that should make the workflow fail.

For early V1, default to advisory mode: publish results without blocking merges. Add an explicit opt-in threshold for teams that want CI enforcement. Never make a failed analyzer look like a successful clean review. Document how GitHub branch protection interacts with the workflow's exit code.

### 16.10 Observability

Emit structured, minimally sensitive logs for:
- Run ID, PR number, head SHA, and reviewer version.
- Number of files and diff bytes considered.
- Per-analyzer status and duration.
- AI provider status, latency, and response-validation status, but not secret values or unnecessary source contents.
- Number of findings before and after normalization/deduplication.
- Publication status and GitHub API errors.

Use explicit timeouts and bounded retries. Redact tokens, authorization headers, environment values, and detected secrets. Avoid storing full diffs in logs.

### 16.11 Threat model

| Threat | Mitigation |
|---|---|
| Prompt injection in comments or source | Treat diff content as untrusted data; no model tool execution; strict output validation |
| Secret exfiltration through model context | Minimize context, detect/redact secrets, exclude secret-bearing files, fail closed on uncertain redaction |
| Malicious PR executes code in privileged job | Do not run untrusted code with secrets; avoid package installation/scripts from PR code in privileged workflows; isolate execution |
| Over-privileged GitHub token | Explicit minimum workflow permissions and documented scopes |
| Malicious Markdown or HTML in output | Escape/sanitize output and do not render untrusted HTML |
| Resource exhaustion via huge diff/model output | Input/output caps, timeouts, file limits, and bounded retries |
| False positives overwhelm reviewers | Evidence requirements, conservative filtering, evaluation fixtures, deduplication |
| False confidence from zero findings | Explicit limitation statement and separate failed/partial/completed statuses |
| Third-party provider receives private code | Make provider use explicit, minimize/redact context, document data handling and offer rules-only/local options |

### 16.12 Architecture decisions and trade-offs

**Decision A: GitHub Actions before a hosted webhook service**
- Benefit: fast setup, low operations burden, easy public demo.
- Trade-off: execution time, event permissions, fork restrictions, and workflow constraints must be handled.
- Revisit when multi-repository centralized configuration, persistent history, or organization-wide administration becomes a real requirement.

**Decision B: Modular monolith before microservices**
- Benefit: easier testing and debugging, fewer deployment components, clear module boundaries.
- Trade-off: no independent scaling of individual components in V1.
- Revisit only when measured workload or trust boundaries justify service separation.

**Decision C: No database in V1**
- Benefit: fewer secrets, migrations, operations, and privacy obligations.
- Trade-off: limited historical analytics and cross-run state.
- Use GitHub-owned comments/checks for initial visible state. Add persistence later only for a clear requirement such as organization-wide analytics or durable evaluation history.

**Decision D: Deterministic analysis plus optional AI**
- Benefit: reproducible baseline and graceful operation without a model.
- Trade-off: maintaining language-specific tool adapters and handling disagreements between sources.
- Preserve provenance for every finding so users can tell which analyzer produced it.

### 16.13 Evolution path if PR Guardian becomes a hosted service

Do not implement this in V1. If usage later justifies it, a possible future architecture is:

```mermaid
flowchart TD
    GH[GitHub App Webhook] --> WH[Webhook API]
    WH --> SIG[Signature Verification and Event Deduplication]
    SIG --> Q[Durable Job Queue]
    Q --> W[Isolated Review Worker]
    W --> A[Analyzer Adapters]
    W --> AI[AI Provider Adapter]
    W --> V[Finding Validation and Policy]
    V --> PUB[GitHub Publisher]
    WH --> DB[(PostgreSQL: installations, runs, metadata)]
    W --> DB
    PUB --> DB
```

A hosted version would need verified webhook signatures, replay protection, durable event deduplication, queue retries, per-installation authorization, tenant isolation, secure secret management, retention/deletion policies, abuse controls, monitoring, and a much more detailed threat model. It should not be treated as a trivial deployment change.

### 16.14 Architecture acceptance criteria

- The core engine can run without GitHub or AI credentials.
- Core modules do not import Octokit or a provider SDK directly.
- Every analyzer reports success, failure, skipped, or timed-out status.
- Findings are runtime-validated before report generation and publishing.
- All user-controlled input and output sizes are bounded.
- AI can be disabled without breaking deterministic review.
- The job summary distinguishes completed, partial, and failed review states.
- Inline comments are optional and require valid line mapping.
- No untrusted PR code runs in a privileged job with secrets.
- Architecture decisions and limitations are documented and covered by tests where practical.

---

## 17. Instructions for Claude: How to Work on This Project

You are acting as a senior software engineer and implementation partner
for PR Guardian. Follow these instructions throughout the project.

### First response and repository inspection

1.  Inspect the current repository before making changes.
2.  If the repository is empty, confirm the working directory and
    initialize the project there.
3.  If code already exists, understand its architecture and conventions
    before changing anything.
4.  Check the installed Node.js and npm versions, Git status, existing
    scripts, and available test commands.
5.  Summarize the current state and propose the smallest next
    implementation step.
6.  Do not overwrite existing files or restructure the project blindly.

### Implementation discipline

-   Work incrementally, milestone by milestone.
-   Start with Milestone 1, then implement Milestone 2 before adding
    GitHub publishing or AI integration.
-   Provide complete, working implementations rather than pseudocode or
    empty placeholders.
-   Prefer small modules with clear responsibilities.
-   Use strict TypeScript and runtime validation for untrusted data.
-   Add tests with each feature.
-   Run relevant tests, lint, typecheck, and build after changes.
-   Report exactly which commands ran and whether they passed.
-   Never claim a test passed if it was not executed.
-   If a command fails, investigate and fix it where possible before
    moving on.
-   Explain important architecture and security decisions briefly.
-   Keep dependencies minimal and explain why new dependencies are
    needed.
-   Do not add a dashboard, database, automatic fixing, or other
    out-of-scope features unless explicitly requested.
-   Ask before performing destructive operations, overwriting important
    files, pushing changes, or publishing anything externally.
-   Never expose secrets or request that secrets be committed to source
    control.

### Security discipline

-   Treat pull request content as hostile input.
-   Do not run untrusted PR code with privileged secrets.
-   Use least-privilege GitHub permissions.
-   Validate model output before processing or publishing it.
-   Bound input sizes, response sizes, execution time, and retries.
-   Avoid sending secret-bearing or irrelevant repository content to AI
    providers.
-   Do not allow the AI to execute arbitrary commands.
-   Report analysis failures as failures or partial results, never as a
    clean bill of health.

### Progress reporting

At the end of each milestone, report: 1. What was implemented. 2. Files
added or changed. 3. Commands and tests executed. 4. Test/build results.
5. Known limitations or unresolved issues. 6. The exact next milestone.

Do not jump to the next milestone if the current milestone is broken. If
a decision is ambiguous, choose the safest minimal option when
reasonable and state the assumption; ask the user only when the decision
materially affects architecture, cost, security, or scope.

### Immediate task

Begin with **Milestone 1 --- Repository foundation**. Inspect the
repository and environment first. Then implement the smallest complete
foundation, verify it, and stop to report results before proceeding to
the local review engine.
