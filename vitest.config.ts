import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only — they must run with no Docker services. Integration tests live under
    // test/integration and have their own config (they need Postgres + Redis).
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/worker/test/unit/**/*.test.ts",
      "apps/web/test/unit/**/*.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      // json-summary feeds `scripts/check-coverage-claims.mjs`. The text reporter omits files
      // that are at 100%, so the two files the README makes claims about are precisely the ones
      // it will not print — the JSON is what makes the claim checkable.
      reporter: ["text", "html", "json-summary"],
      include: ["apps/worker/src/health/**/*.ts", "apps/worker/src/ai/**/*.ts", "packages/shared/src/**/*.ts"],
      // engine.ts and summarize.ts are I/O shells over the pure cores below; they are covered by
      // the integration suite, not here, and their presence would only dilute the numbers.
      exclude: ["apps/worker/src/health/engine.ts", "apps/worker/src/ai/summarize.ts"],
      // The two files the README makes claims about (phase 9 acceptance).
      thresholds: {
        "apps/worker/src/health/rules.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "apps/worker/src/ai/redact.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
  resolve: {
    // Mirrors the extensionAlias trick in next.config.ts: packages/shared re-exports with
    // explicit .js specifiers (required by the worker's NodeNext build), which Vite has to
    // map back onto the .ts sources.
    extensions: [".ts", ".tsx", ".js", ".json"],
    // Same `@` → apps/web mapping the app and the integration config use, so a web unit test can
    // import a component without rewriting its specifiers.
    alias: { "@": fileURLToPath(new URL("./apps/web", import.meta.url)) },
  },
});
