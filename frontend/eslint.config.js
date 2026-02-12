import globals from "globals";
import jsBase from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.js"],
    extends: [jsBase.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
    }
  }
]);
