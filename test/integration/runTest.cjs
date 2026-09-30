// Boots a real VS Code (the minimum supported version) with Orbit loaded and a
// fake Claude data folder, then runs suite.cjs inside the extension host.
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { runTests } = require("@vscode/test-electron");

const HERE_ID = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const AWAY_ID = "11111111-2222-4333-8444-555555555555";

const BLOB = "0123456789abcdef@v1";

function transcript(id, cwd, prompt) {
  const base = { cwd, sessionId: id, gitBranch: "main", entrypoint: "cli", isSidechain: false };
  return [
    { type: "mode", mode: "normal", sessionId: id },
    {
      ...base,
      type: "user",
      timestamp: "2026-09-29T10:00:00.000Z",
      message: { role: "user", content: prompt },
    },
    {
      ...base,
      type: "assistant",
      timestamp: "2026-09-29T10:01:00.000Z",
      message: {
        id: `msg_${id.slice(0, 8)}`,
        model: "claude-opus-5-5",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 10,
          output_tokens: 50,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 100,
        },
      },
    },
    { type: "ai-title", aiTitle: `${prompt} (title)`, sessionId: id },
    {
      type: "file-history-delta",
      messageId: `msg_${id.slice(0, 8)}`,
      trackingPath: "app.js",
      backup: {
        backupFileName: BLOB,
        version: 1,
        backupTime: "2026-09-29T10:00:30.000Z",
        realParentDir: cwd,
      },
      timestamp: "2026-09-29T10:00:30.000Z",
    },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n");
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "orbit-it-"));
  const claude = join(root, "claude");
  const workspace = join(root, "shop");
  const away = join(root, "api");
  for (const [id, cwd, prompt] of [
    [HERE_ID, workspace, "Fix checkout"],
    [AWAY_ID, away, "Write docs"],
  ]) {
    mkdirSync(cwd, { recursive: true });
    const dir = join(claude, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.jsonl`), transcript(id, cwd, prompt));
  }
  // One checkpoint in the "here" chat: app.js before Claude's edit, and as it is now.
  const blobs = join(claude, "file-history", HERE_ID);
  mkdirSync(blobs, { recursive: true });
  writeFileSync(join(blobs, BLOB), "const total = 1;\n");
  writeFileSync(join(workspace, "app.js"), "const total = 2;\n");

  try {
    await runTests({
      version: "1.94.0",
      extensionDevelopmentPath: resolve(__dirname, "../.."),
      extensionTestsPath: resolve(__dirname, "suite.cjs"),
      launchArgs: [workspace, "--disable-extensions", "--user-data-dir", join(root, "user")],
      extensionTestsEnv: {
        CLAUDE_CONFIG_DIR: claude,
        ORBIT_IT_HERE: HERE_ID,
        ORBIT_IT_AWAY: AWAY_ID,
        ORBIT_IT_APP: join(workspace, "app.js"),
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
