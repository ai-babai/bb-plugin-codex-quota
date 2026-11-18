import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import coverage from "istanbul-lib-coverage";
import { runtimeCycles } from "./cycles.mjs";
import { changedLineCoverage } from "./diff.mjs";
import { complexityByFunction, coverageByFunction } from "./functions.mjs";
import { reportsDirectory, runtimeFiles } from "./scope.mjs";

const limits = { cc: 10, cognitive: 15, crapAverage: 5, crapMax: 30, diffCoverage: 0.8 };

async function readResults(cwd) {
  const eslint = new ESLint({ cwd, overrideConfig: { rules: {
    complexity: ["error", 0],
    "sonarjs/cognitive-complexity": ["error", 0],
  } } });
  const coveragePath = join(cwd, reportsDirectory, "coverage-final.json");
  const map = coverage.createCoverageMap(JSON.parse(readFileSync(coveragePath, "utf8")));
  return (await eslint.lintFiles(runtimeFiles)).map(({ filePath, messages }) => {
    const file = relative(cwd, filePath).replaceAll("\\", "/");
    const fileCoverage = map.fileCoverageFor(filePath);
    const functions = complexityByFunction(readFileSync(filePath, "utf8"), messages, filePath);
    const fractions = coverageByFunction(functions, fileCoverage);
    return { file, coverage: fileCoverage, functions: functions.map((fn, index) => ({
      file,
      name: fn.name,
      line: fn.loc.start.line,
      column: fn.loc.start.column + 1,
      cc: fn.cc,
      cognitive: fn.cognitive,
      coverage: fractions[index],
      crap: fn.cc + fn.cc ** 2 * (1 - fractions[index]) ** 3,
    })) };
  });
}

export async function buildReport(cwd, base, tree) {
  const results = await readResults(cwd);
  const functions = results.flatMap((result) => result.functions).sort((a, b) => b.crap - a.crap);
  if (!functions.length) throw new Error("No runtime function complexity measurements");
  const lines = changedLineCoverage(cwd, tree, results);
  const covered = lines.filter((line) => line.covered).length;
  const cycles = await runtimeCycles(results.map(({ file }) => file));
  return {
    base,
    tree,
    limits,
    functions,
    maxCc: Math.max(...functions.map(({ cc }) => cc)),
    maxCognitive: Math.max(...functions.map(({ cognitive }) => cognitive)),
    averageCrap: functions.reduce((sum, { crap }) => sum + crap, 0) / functions.length,
    maxCrap: functions[0].crap,
    diff: { covered, total: lines.length, fraction: lines.length ? covered / lines.length : null, lines },
    cycles,
  };
}

export function failures(report) {
  const { maxCc, maxCognitive, averageCrap, maxCrap, cycles, diff } = report;
  const failed = [];
  if (maxCc > limits.cc) failed.push(`CC ${maxCc} exceeds ${limits.cc}`);
  if (maxCognitive > limits.cognitive) failed.push(`Cognitive Complexity ${maxCognitive} exceeds ${limits.cognitive}`);
  if (averageCrap >= limits.crapAverage) failed.push(`Average CRAP must be below ${limits.crapAverage}`);
  if (maxCrap > limits.crapMax) failed.push(`Maximum CRAP must be at most ${limits.crapMax}`);
  if (diff.fraction !== null && diff.fraction < limits.diffCoverage) failed.push("Changed executable-line coverage is below 80%");
  if (cycles.length) failed.push("The runtime import graph contains cycles");
  return failed;
}

export function printReport(report) {
  const { functions, maxCc, maxCognitive, averageCrap, maxCrap, cycles, diff } = report;
  console.log(`${functions.length} functions | CC max ${maxCc} | Cognitive max ${maxCognitive} | CRAP avg ${averageCrap.toFixed(2)}, max ${maxCrap.toFixed(2)}`);
  const coverage = diff.fraction === null ? "N/A (no changed executable lines)"
    : `${(100 * diff.fraction).toFixed(2)}% (${diff.covered}/${diff.total})`;
  console.log(`Changed executable-line coverage ${coverage} | runtime cycle violations ${cycles.length}`);
  const high = functions.filter((fn) => fn.cc > limits.cc || fn.cognitive > limits.cognitive || fn.crap > limits.crapMax);
  for (const fn of high.length ? high : functions.slice(0, 5)) {
    console.log(`${fn.file}:${fn.line}:${fn.column} ${fn.name} | CC ${fn.cc}, Cognitive ${fn.cognitive}, CRAP ${fn.crap.toFixed(2)}`);
  }
  for (const { from, to } of cycles) console.log(`Runtime cycle edge: ${from} → ${to}`);
  if (diff.fraction !== null && diff.fraction < limits.diffCoverage) {
    const uncovered = diff.lines.filter(({ covered }) => !covered);
    console.log(`Uncovered changed lines: ${uncovered.slice(0, 20).map(({ file, line }) => `${file}:${line}`).join(", ")}${uncovered.length > 20 ? " …" : ""}`);
  }
}
