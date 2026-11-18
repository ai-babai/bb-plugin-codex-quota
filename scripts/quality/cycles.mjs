import { cruise } from "dependency-cruiser";

export async function runtimeCycles(files) {
  const escapedPaths = files.map((file) => file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const { output } = await cruise(files, {
    outputType: "json",
    includeOnly: `^(?:${escapedPaths.join("|")})$`,
    // Cruise the emitted TypeScript imports, where erased type imports are absent.
    tsPreCompilationDeps: false,
    tsConfig: { fileName: "tsconfig.json" },
    validate: true,
    ruleSet: { forbidden: [{ name: "no-runtime-cycle", severity: "error", from: {}, to: { circular: true } }] },
  });
  const { modules, summary } = JSON.parse(output);
  const analyzed = new Set(modules.map(({ source }) => source));
  const missing = files.filter((file) => !analyzed.has(file));
  if (missing.length) throw new Error(`Dependency graph is missing: ${missing.join(", ")}`);
  return summary.violations.map(({ from, to, cycle }) => ({ from, to, cycle }));
}
