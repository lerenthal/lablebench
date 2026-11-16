import eslint from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import svelteConfig from "./svelte.config.js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  svelte.configs.recommended,
  [
    {
      languageOptions: {
        globals: {
          ...globals.browser,
          ...globals.node,
        },
      },
    },
    {
      files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],

      languageOptions: {
        parserOptions: {
          projectService: true,
          extraFileExtensions: [".svelte"], // Add support for additional file extensions, such as .svelte
          parser: tseslint.parser,
          svelteConfig,
        },
      },
    },
    {
      ignores: ["dist/", "capacitor/"],
    },
    {
      rules: {
        "@typescript-eslint/no-explicit-any": "off",

        // A leading underscore is how this codebase says "named so the shape
        // reads, not because anything uses it" - the id dropped from a
        // template before it is imported as a new one, for instance.
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
          },
        ],
      },
    },
  ]
);
