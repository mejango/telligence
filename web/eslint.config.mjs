import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Next's plugin set still exposes the ESLint 9 rule API. Adapt those rules
  // without disabling them while the ecosystem completes its ESLint 10 move.
  ...fixupConfigRules([...nextVitals, ...nextTypeScript]),
  prettier,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      // These React Compiler diagnostics are eligibility checks. This app does
      // not enable the compiler, so adoption remains a deliberate state-model
      // migration rather than part of dependency maintenance.
      "react-hooks/error-boundaries": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // `eslint-config-next/typescript` is loaded explicitly for ESLint 10
      // parser compatibility. Preserve the repository's prior rule surface;
      // TypeScript remains the source of truth for type correctness.
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-trailing-spaces": "off",
      quotes: "off",
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);
