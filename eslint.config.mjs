import parser from "@typescript-eslint/parser";
import sonarjs from "eslint-plugin-sonarjs";
import { runtimeFiles } from "./scripts/quality/scope.mjs";

export default [{ ignores: [".release/**", "dist/**"] }, {
  files: runtimeFiles,
  languageOptions: { parser },
  linterOptions: { noInlineConfig: true },
  plugins: { sonarjs },
  rules: {
    complexity: ["error", 10],
    "sonarjs/cognitive-complexity": ["error", 15],
  },
}];
