import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  resolve: {
    alias: { vscode: fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    exclude: ["test/integration/**", "node_modules/**"],
    testTimeout: 15000,
  },
});
