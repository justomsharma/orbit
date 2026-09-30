import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Speed budgets only, one file at a time, so other tests' disk I/O can't skew timings.
export default defineConfig({
  resolve: {
    alias: { vscode: fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url)) },
  },
  test: {
    include: ["test/perf/**/*.perf.test.ts"],
    fileParallelism: false,
    testTimeout: 120000,
  },
});
