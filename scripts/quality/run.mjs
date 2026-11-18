import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { localBase, resolveBase } from "./diff.mjs";
import { buildReport, failures, printReport } from "./report.mjs";
import { reportsDirectory } from "./scope.mjs";

function npm(...args) {
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], { stdio: "inherit" });
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: "string" }, check: { type: "boolean" } } });
  const cwd = process.cwd();
  const base = values.base ?? process.env.QUALITY_BASE ?? localBase(cwd);
  const tree = resolveBase(cwd, base);
  console.log(`Quality diff base ${base} (tree ${tree})`);
  if (values.check) npm("run", "typecheck");
  npm("run", "test:coverage");
  execFileSync(process.execPath, ["--test", "scripts/quality/quality.test.mjs"], { stdio: "inherit" });
  const report = await buildReport(cwd, base, tree);
  writeFileSync(join(cwd, reportsDirectory, "quality.json"), `${JSON.stringify(report, null, 2)}\n`);
  printReport(report);
  const failed = failures(report);
  if (failed.length) throw new Error(failed.join("\n"));

  if (values.check) {
    npm("run", "build");
    npm("run", "check:package");
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
