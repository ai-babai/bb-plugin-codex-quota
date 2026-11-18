import { defineConfig } from "vitest/config";
import { reportsDirectory, runtimeFiles } from "./scripts/quality/scope.mjs";

export default defineConfig({
  test: {
    include: ["tests/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: runtimeFiles,
      reporter: ["text-summary", "json", "lcovonly"],
      reportsDirectory,
    },
  },
});
