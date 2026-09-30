import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Read-only probes against this machine's real ~/.claude (test/local is git-ignored).
export default defineConfig({
  resolve: {
    alias: { vscode: fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url)) },
  },
  test: {
    include: ["test/local/**/*.local.test.ts"],
    fileParallelism: false,
    testTimeout: 180000,
    silent: false,
  },
});
