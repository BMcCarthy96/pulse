import js from "@eslint/js";
import tseslint from "typescript-eslint";

// This config applies to apps/worker, packages/shared, and packages/db —
// apps/web has its own eslint.config.mjs (eslint-config-next) that shadows this one.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "apps/web/**",
      "packages/db/prisma/migrations/**",
      "packages/db/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
);
