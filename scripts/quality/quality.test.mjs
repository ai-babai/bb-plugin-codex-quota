import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import { addedLines, changedLineCoverage, emptyTree, localBase, resolveBase } from "./diff.mjs";
import { complexityByFunction, coverageByFunction } from "./functions.mjs";
import { failures } from "./report.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "codex-quota-quality-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("diff coverage counts executable additions in tracked and untracked files", (t) => {
  const cwd = fixture(t);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  assert.equal(localBase(cwd), emptyTree(cwd));
  writeFileSync(join(cwd, "tracked.ts"), "line 1\nline 2\nline 3\n");
  git("add", "tracked.ts");
  const base = resolveBase(cwd, git("write-tree"));
  writeFileSync(join(cwd, "tracked.ts"), "line 1\nchanged line 2\n// comment\nline 3\n");
  git("add", "tracked.ts");
  writeFileSync(join(cwd, "new.ts"), "new line\n");
  const files = [["tracked.ts", { 1: 1, 2: 1, 4: 0 }], ["new.ts", { 1: 0 }]];
  const coverage = files.map(([file, lines]) => ({ file, coverage: { getLineCoverage: () => lines } }));
  assert.deepEqual(changedLineCoverage(cwd, base, coverage), [
    { file: "tracked.ts", line: 2, covered: true }, { file: "new.ts", line: 1, covered: false },
  ]);
  assert.deepEqual([...addedLines("@@ -5 +5,0 @@\n@@ -6 +9 @@\n")], [9]);
});

test("runtime cycles exclude type-only edges and reject real circular imports", (t) => {
  const cwd = fixture(t);
  const files = ["a.ts", "b.ts"];
  const tsconfig = join(cwd, "tsconfig.json");
  const cyclesModule = new URL("./cycles.mjs", import.meta.url).href;
  const cycles = () => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    `import { runtimeCycles } from ${JSON.stringify(cyclesModule)}; console.log(JSON.stringify(await runtimeCycles(${JSON.stringify(files)})));`,
  ], { cwd, encoding: "utf8" }));
  writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { module: "ESNext", target: "ES2022" } }));
  writeFileSync(join(cwd, "a.ts"), 'import type { B } from "./b"; export type { B }; export const a = 1;');
  writeFileSync(join(cwd, "b.ts"), 'import { a } from "./a"; export type B = string; export const b = () => a;');
  assert.deepEqual(cycles(), []);
  writeFileSync(join(cwd, "a.ts"), 'import { b } from "./b"; export const a = () => b;');
  assert.ok(cycles().some(({ from, to }) => from === "a.ts" && to === "b.ts"));
});

test("maps native metrics to async methods and nested callbacks on the same line", async () => {
  const filePath = "lib/fixture.ts";
  const source = "const actions = { async run() { return [true].map(x => x ? 1 : 0).filter(x => x > 0); } };";
  const eslint = new ESLint({ overrideConfig: { rules: {
    complexity: ["error", 0], "sonarjs/cognitive-complexity": ["error", 0],
  } } });
  const [{ messages }] = await eslint.lintText(source, { filePath });
  const functions = complexityByFunction(source, messages, filePath);
  assert.deepEqual(functions.map(({ name, cc, cognitive }) => [name, cc, cognitive]), [
    ["run", 1, 0], ["run › [true].map callback #1", 2, 1], ["run › [true].map(x => x ? 1 : 0).filter callback #1", 1, 0],
  ]);
  const [outer, map, filter] = functions;
  const bodyStart = (fn) => ({ start: fn.body.start });
  const coverage = coverageByFunction(functions, { path: filePath, data: {
    statementMap: { 0: bodyStart(outer), 1: bodyStart(map) }, s: { 0: 1, 1: 0 },
    fnMap: { 0: { loc: bodyStart(filter) } }, f: { 0: 1 },
  } });
  assert.deepEqual(coverage, [1, 0, 1]);
});

test("separates execution of callbacks merged into one V8 function record", async () => {
  const filePath = "lib/fixture.ts";
  const source = "function setup() {\n  effect(() => () => 42);\n}";
  const eslint = new ESLint({ overrideConfig: { rules: {
    complexity: ["error", 0], "sonarjs/cognitive-complexity": ["error", 0],
  } } });
  const [{ messages }] = await eslint.lintText(source, { filePath });
  const functions = complexityByFunction(source, messages, filePath);
  const onLine = (start, end) => ({ start: { line: 2, column: start }, end: { line: 2, column: end } });
  const merged = onLine(2, 23);
  const data = {
    statementMap: { 0: onLine(2, null), 1: merged, 2: onLine(21, 23) },
    s: { 0: 1, 1: 1, 2: 0 },
    fnMap: { 0: { loc: functions[0].body }, 1: { loc: merged, decl: onLine(2, 21) } },
    f: { 0: 1, 1: 1 },
  };
  // The outer callback ran and returned the inner callback, which never ran.
  assert.deepEqual(coverageByFunction(functions, { path: filePath, data }), [1, 1, 0]);
});

test("enforces exact thresholds including the strict mean CRAP bound", () => {
  const report = { maxCc: 10, maxCognitive: 15, averageCrap: 4.99, maxCrap: 30, cycles: [], diff: { fraction: 0.8 } };
  assert.deepEqual(failures(report), []);
  assert.deepEqual(failures({ ...report, diff: { fraction: null } }), []);
  assert.equal(failures({ ...report, maxCc: 11, maxCognitive: 16, averageCrap: 5, maxCrap: 30.01, cycles: ["cycle"], diff: { fraction: 0.7999 } }).length, 6);
});
