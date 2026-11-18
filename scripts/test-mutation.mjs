import { Stryker } from "@stryker-mutator/core";

const mutants = await new Stryker({ configFile: "stryker.config.mjs" }).runMutationTest();
const scoredStatuses = new Set(["Killed", "Survived", "NoCoverage", "Timeout"]);
if (!mutants.some(({ status }) => scoredStatuses.has(status))) {
  throw new Error("Stryker produced no scorable mutants.");
}
