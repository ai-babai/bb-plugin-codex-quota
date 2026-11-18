import { execFileSync, spawnSync } from "node:child_process";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

export function resolveBase(cwd, base) {
  return git(cwd, "rev-parse", "--verify", "--end-of-options", `${base}^{tree}`).trim();
}

export function emptyTree(cwd) {
  return execFileSync("git", ["hash-object", "-t", "tree", "-w", "--stdin"], { cwd, encoding: "utf8", input: "" }).trim();
}

export function localBase(cwd) {
  const head = spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd });
  if (head.status === 1) return emptyTree(cwd);
  if (head.status !== 0) throw new Error(head.error?.message ?? head.stderr.toString().trim());
  if (git(cwd, "status", "--porcelain=v1", "--untracked-files=normal").trim()) return "HEAD";
  const [, firstParent] = git(cwd, "rev-list", "--parents", "-n1", "HEAD").trim().split(" ");
  return firstParent ?? emptyTree(cwd);
}

export function addedLines(diff) {
  const lines = new Set();
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = Number(match[2] ?? 1);
    for (let line = start; line < start + count; line++) lines.add(line);
  }
  return lines;
}

export function changedLineCoverage(cwd, tree, files) {
  const tracked = new Set(git(cwd, "ls-files", "--cached", "-z").split("\0"));
  const records = [];
  for (const { file, coverage } of files) {
    const diff = tracked.has(file)
      ? addedLines(git(cwd, "--literal-pathspecs", "diff", "--text", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=0", tree, "--", file))
      : null;
    for (const [line, hits] of Object.entries(coverage.getLineCoverage())) {
      if (!diff || diff.has(Number(line))) records.push({ file, line: Number(line), covered: hits > 0 });
    }
  }
  return records;
}
