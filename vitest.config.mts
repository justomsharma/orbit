import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  resolve: {
    alias: { vscode: fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    // test/local: probes against this machine's real ~/.claude (git-ignored); npm run test:local.
    exclude: ["test/integration/**", "test/perf/**", "test/local/**", "node_modules/**"],
    testTimeout: 15000,
  },
});
