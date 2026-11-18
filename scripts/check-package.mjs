import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const output = execFileSync(process.execPath, [
  process.env.npm_execpath,
  "pack",
  "--dry-run",
  "--ignore-scripts",
  "--json",
], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
const [pack] = JSON.parse(output);

const expected = new Set(["package.json", ...manifest.files]);
const packed = new Set(pack.files.map(({ path }) => path));
const missing = [...expected].filter((path) => !packed.has(path));
const unexpected = [...packed].filter((path) => !expected.has(path));

if (missing.length || unexpected.length) {
  for (const path of missing) console.error(`Missing from package: ${path}`);
  for (const path of unexpected) console.error(`Unexpected file in package: ${path}`);
  process.exitCode = 1;
} else {
  console.log(`Package contents verified (${packed.size} files).`);
}
