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
      include: [
        "apps/worker/src/health/**/*.ts",
        "apps/worker/src/ai/**/*.ts",
        "packages/shared/src/**/*.ts",
      ],
      // engine.ts and summarize.ts are I/O shells over the pure cores below; they are covered by
      // the integration suite, not here, and their presence would only dilute the numbers.
      exclude: ["apps/worker/src/health/engine.ts", "apps/worker/src/ai/summarize.ts"],
      // The two files the README makes claims about (phase 9 acceptance).
      thresholds: {
        "apps/worker/src/health/rules.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "packages/shared/src/redact.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "packages/shared/src/ai-budget.ts": {
          branches: 90,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "packages/shared/src/tracked-jobs.ts": {
          branches: 80,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
  resolve: {
    // Mirrors the extensionAlias trick in next.config.ts: packages/shared re-exports with
    // explicit .js specifiers (required by the worker's NodeNext build), which Vite has to
    // map back onto the .ts sources.
    extensions: [".ts", ".tsx", ".js", ".json"],
    // `@` → apps/web, same mapping the app and the integration config use, so a web unit test
    // can import a component without rewriting its specifiers.
    //
    // The `@pulse/*` entries point the suite at TypeScript **source**. Since those packages now
    // publish `dist` for the `default` export condition (so `node dist/index.js` works in the
    // worker container), resolving them normally would make `pnpm test` depend on a prior
    // `pnpm build` — and would instrument `dist` instead of the `packages/shared/src/**` paths
    // the coverage thresholds are written against. Order matters: the subpath is listed first,
    // because these are prefix matches.
    alias: {
      "@pulse/shared/webhook-signature": fileURLToPath(
        new URL("./packages/shared/src/webhook-signature.ts", import.meta.url),
      ),
      "@pulse/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@pulse/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
});
