import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/mocks/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      // Keep every production TypeScript module in the denominator, including
      // unimported route/UI modules and generated runtime code.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        statements: 11.8,
        branches: 7.6,
        functions: 8.5,
        lines: 12,
        "src/app/api/bendystraw/[net]/[key]/graphql/route.ts": {
          statements: 69,
          branches: 65,
          functions: 100,
          lines: 69,
        },
        "src/hooks/useAllowance.ts": {
          statements: 94,
          branches: 85,
          functions: 100,
          lines: 100,
        },
        "src/hooks/useReviewedRelayr.ts": {
          statements: 72,
          branches: 62,
          functions: 54,
          lines: 76,
        },
        "src/hooks/useReviewedWriteContract.ts": {
          statements: 59,
          branches: 42,
          functions: 44,
          lines: 63,
        },
        "src/lib/bridgePrepare.ts": {
          statements: 84,
          branches: 78,
          functions: 100,
          lines: 87,
        },
        "src/lib/cashOutQuote.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/lib/loanTransactions.ts": {
          statements: 80,
          branches: 70,
          functions: 100,
          lines: 85,
        },
        "src/lib/server/readBoundedBody.ts": {
          statements: 85,
          branches: 65,
          functions: 100,
          lines: 88,
        },
      },
    },
  },
});
