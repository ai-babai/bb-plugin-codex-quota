---
type: Quality Guide
description: How to run the Codex Quota quality gate, select a Git diff base, and interpret coverage and complexity results.
created: "2026-11-18"
---
# Quality checks

Run the same gate locally and in CI. CI uses Node 24 and BB CLI 0.49.0.

```sh
npm ci --ignore-scripts
npm run check
npm run check -- --base origin/main
```

`npm run check` checks types, collects coverage while running the plugin tests,
runs the quality tool's own tests, applies the gates below, builds the plugin
with `bb` on `PATH`, and verifies the npm archive with a dry run.
`npm run quality` runs the tests, coverage and quality gates alone.
`npm test` runs the plugin tests. `npx eslint .` reports complexity violations
at the same thresholds used by the gate.

## Diff base

Pass `--base <commit-or-tree>` or set `QUALITY_BASE` to audit a specific range.
The command prints the selected base and its resolved tree hash. Local runs
with worktree changes compare against `HEAD`, including staged, unstaged and
untracked runtime files. A clean checkout compares against the first parent
of `HEAD`. A clean root or shallow checkout without that parent, or a Git
repository without a commit, uses an empty tree and measures every executable
runtime line. Selecting an empty tree writes a Git tree object and leaves the
commit history intact.

CI compares the pull request merge checkout against the event's base commit.
Push runs use the previous tip from the event. A newly created ref has no
previous tip, so its first push compares against an empty tree and must reach
the same 80% threshold across the entire runtime.

## Gates

Runtime scope covers `app.tsx`, `host.ts`, `server.ts`, and `lib/**/*.{ts,tsx}`.
Static metrics cover all runtime functions. Only the line coverage gate uses
the Git diff.

| Measure | Threshold and method |
| --- | --- |
| Cyclomatic complexity | At most 10 per function. Uses ESLint's `complexity` rule with the classic variant. |
| Cognitive Complexity | At most 15 per function. Uses SonarJS's `cognitive-complexity` rule. |
| CRAP | Mean strictly below 5 and maximum at most 30. `CC + CC² × (1 − coverage)³` uses the fraction of executable lines covered in each function. |
| Runtime import cycles | Zero cycle violations. dependency-cruiser checks the compiled import graph between runtime files after TypeScript erases type-only edges. |
| Changed executable-line coverage | At least 80%. Intersects added or replaced lines in a zero-context Git diff with the V8 line report. Deleted lines leave the denominator. An empty intersection is reported as N/A. |

For CRAP, each source-mapped statement belongs to the innermost function
whose body contains its start. Statements on the same line count as one line
within that function. For a function with no mapped statements, the gate
uses its V8 function counter. When V8 merges two nested arrow function counters,
the gate uses their separate statement counters. This makes CRAP a line coverage estimate. See the
separate branch coverage numbers in Vitest's summary when reviewing behavior.

The runner reads ESLint's two configured rules at threshold zero to collect
their numerical diagnostics. It joins each diagnostic to its TypeScript
function location and includes callback context in the report. Missing or
ambiguous measurements stop the gate.

The console reports the thresholds exceeded, the locations of the relevant
functions and a sample of uncovered changed lines. Full results are in
`node_modules/.cache/codex-quota-quality/quality.json`, alongside V8's
`coverage-final.json` and `lcov.info`. CI uploads the quality report and LCOV.

## Mutation tests

Run `npm run test:mutation` to check whether the tests detect changes in
`lib/quota-time.ts`, which controls countdown rounding and quota freshness.
Stryker runs the Vitest suite against those changes. The separate CI job
requires a mutation score of at least 95% and at least one scored mutation.
