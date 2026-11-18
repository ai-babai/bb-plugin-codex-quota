export default {
  mutate: ["lib/quota-time.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",
  allowEmpty: false,
  concurrency: 2,
  reporters: ["clear-text"],
  thresholds: { break: 95 },
  ignorePatterns: [".release", "dist", "coverage", "reports"],
};
