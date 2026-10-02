// Dev-only: builds a static page that runs the real webview bundle with VS Code
// theme variables and sample data, for visual review in a normal browser.
//   node scripts/preview.mjs  →  .superpowers/preview/{dark,light}.html
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const out = ".superpowers/preview";
mkdirSync(out, { recursive: true });
for (const f of ["main.js", "main.css", "codicon.css", "codicon.ttf"]) {
  copyFileSync(join("dist/webview", f), join(out, f));
}

const themes = {
  dark: {
    "--vscode-font-family": "-apple-system, 'Segoe UI', system-ui, sans-serif",
    "--vscode-font-size": "13px",
    "--vscode-editor-font-family": "Consolas, monospace",
    "--vscode-foreground": "#cccccc",
    "--vscode-descriptionForeground": "#9d9d9d",
    "--vscode-sideBar-background": "#181818",
    "--vscode-list-hoverBackground": "#2a2d2e",
    "--vscode-list-activeSelectionBackground": "#04395e",
    "--vscode-list-activeSelectionForeground": "#ffffff",
    "--vscode-focusBorder": "#0078d4",
    "--vscode-widget-border": "#313131",
    "--vscode-button-background": "#0078d4",
    "--vscode-button-foreground": "#ffffff",
    "--vscode-button-hoverBackground": "#026ec1",
    "--vscode-button-secondaryBackground": "#313131",
    "--vscode-button-secondaryForeground": "#cccccc",
    "--vscode-button-secondaryHoverBackground": "#3c3c3c",
    "--vscode-input-background": "#313131",
    "--vscode-input-foreground": "#cccccc",
    "--vscode-input-border": "#3c3c3c",
    "--vscode-input-placeholderForeground": "#989898",
    "--vscode-toolbar-hoverBackground": "#5a5d5e50",
    "--vscode-charts-green": "#89d185",
    "--vscode-charts-blue": "#3794ff",
    "--vscode-charts-orange": "#d18616",
    "--vscode-charts-purple": "#b180d7",
    "--vscode-charts-red": "#f14c4c",
    "--vscode-charts-yellow": "#cca700",
    "--vscode-editorWarning-foreground": "#cca700",
    "--vscode-errorForeground": "#f85149",
    "--vscode-textLink-foreground": "#4daafc",
    "--vscode-badge-background": "#616161",
    "--vscode-badge-foreground": "#f8f8f8",
    "--vscode-editor-background": "#1f1f1f",
  },
  light: {
    "--vscode-font-family": "-apple-system, 'Segoe UI', system-ui, sans-serif",
    "--vscode-font-size": "13px",
    "--vscode-editor-font-family": "Consolas, monospace",
    "--vscode-foreground": "#3b3b3b",
    "--vscode-descriptionForeground": "#717171",
    "--vscode-sideBar-background": "#f8f8f8",
    "--vscode-list-hoverBackground": "#f2f2f2",
    "--vscode-list-activeSelectionBackground": "#e8e8e8",
    "--vscode-list-activeSelectionForeground": "#000000",
    "--vscode-focusBorder": "#005fb8",
    "--vscode-widget-border": "#e5e5e5",
    "--vscode-button-background": "#005fb8",
    "--vscode-button-foreground": "#ffffff",
    "--vscode-button-hoverBackground": "#0258a8",
    "--vscode-button-secondaryBackground": "#e5e5e5",
    "--vscode-button-secondaryForeground": "#3b3b3b",
    "--vscode-button-secondaryHoverBackground": "#cccccc",
    "--vscode-input-background": "#ffffff",
    "--vscode-input-foreground": "#3b3b3b",
    "--vscode-input-border": "#cecece",
    "--vscode-input-placeholderForeground": "#767676",
    "--vscode-toolbar-hoverBackground": "#b8b8b850",
    "--vscode-charts-green": "#388a34",
    "--vscode-charts-blue": "#1a85ff",
    "--vscode-charts-orange": "#d18616",
    "--vscode-charts-purple": "#652d90",
    "--vscode-charts-red": "#e51400",
    "--vscode-charts-yellow": "#bf8803",
    "--vscode-editorWarning-foreground": "#bf8803",
    "--vscode-errorForeground": "#e51400",
    "--vscode-textLink-foreground": "#005fb8",
    "--vscode-badge-background": "#cccccc",
    "--vscode-badge-foreground": "#3b3b3b",
    "--vscode-editor-background": "#ffffff",
  },
};

const now = Date.now();
const H = 3600_000;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const chats = [
  [
    "Fix checkout race condition",
    "shop",
    "fix/checkout-race",
    0.2,
    34,
    ["https://github.com/acme/shop/pull/412"],
  ],
  ["Add dark mode toggle to settings", "shop", "feature/dark-mode", 2, 12, []],
  ["Why is the CI build so slow?", "api", "main", 5, 8, []],
  [
    "Migrate auth to OAuth 2.1",
    "api",
    "feature/oauth",
    20,
    51,
    ["https://github.com/acme/api/pull/88"],
  ],
  ["Write onboarding docs for new hires", "handbook", "main", 30, 6, []],
  ["Refactor payment webhooks", "shop", "refactor/webhooks", 50, 22, []],
  ["Profile memory leak in worker", "api", "perf/worker", 80, 17, []],
  ["Set up Playwright e2e tests", "shop", "test/e2e", 200, 29, []],
  ["Plan Q4 roadmap outline", "handbook", null, 400, 4, []],
  ["Upgrade to Node 24", "api", "chore/node24", 900, 9, []],
].map(([title, project, branch, hoursAgo, prompts, prLinks], i) => ({
  id: id(i + 1),
  file: "",
  cwd: `/Users/ana/code/${project}`,
  project,
  title,
  firstPrompt: title,
  branch,
  startedAt: now - hoursAgo * H - H,
  lastActiveAt: now - hoursAgo * H,
  prompts,
  estimated: false,
  model: "claude-opus-5-5",
  entrypoint: "cli",
  prLinks,
  continuedIn: null,
  sizeBytes: 1,
}));

const sample = {
  type: "sessions",
  items: chats,
  onboarding: { done: ["find", "setup"], dismissed: false, welcomed: true },
  live: [
    { sessionId: id(1), pid: 1, status: "busy", name: null, updatedAt: now },
    { sessionId: id(3), pid: 2, status: "idle", name: null, updatedAt: now },
  ],
  pins: [id(4)],
  renames: {},
  tags: {},
  here: chats.filter((c) => c.project === "shop").map((c) => c.id),
  env: {
    claudeExtension: true,
    hasWorkspace: true,
    platform: "darwin",
    prefs: { openChatsIn: "terminal", terminalLocation: "editor" },
  },
};
const accountMsg = {
  type: "account",
  data: {
    profile: {
      id: "acc-ana",
      name: "Ana Ruiz",
      email: "ana@acme.dev",
      organization: "Acme",
      role: "admin",
      plan: "Max 20x",
      since: null,
    },
    saved: [
      {
        id: "acc-ana",
        name: "Ana Ruiz",
        email: "ana@acme.dev",
        plan: "Max 20x",
        organization: "Acme",
        savedAt: now,
      },
      {
        id: "acc-side",
        name: "Ana",
        email: "ana.side@gmail.com",
        plan: "Pro",
        organization: null,
        savedAt: now,
      },
    ],
    canSwitch: true,
    switchedAt: null,
  },
};
const checkpointsMsg = {
  type: "checkpoints",
  items: [
    { id: id(1), files: 6, versions: 14, bytes: 412_000, newest: now - 0.4 * H },
    { id: id(2), files: 3, versions: 5, bytes: 38_400, newest: now - 5 * H },
    { id: id(4), files: 21, versions: 52, bytes: 1_900_000, newest: now - 30 * H },
    { id: id(6), files: 2, versions: 2, bytes: 9_800, newest: now - 80 * H },
    {
      id: "9f8e7d6c-0000-4000-8000-00000000abcd",
      files: 1,
      versions: 3,
      bytes: 4_100,
      newest: now - 300 * H,
    },
  ],
};

// Sample usage from the test fixture (bundled on the fly, since it is TypeScript).
await esbuild.build({
  stdin: {
    contents: `export { sampleUsage } from "./test/helpers/usageFixture.ts";
export { sampleSetup } from "./test/helpers/setupFixture.ts";
export { settingsCatalog } from "./src/features/setup/catalog.ts";`,
    resolveDir: ".",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(out, "fixture.mjs"),
  logLevel: "silent",
});
const { sampleUsage, sampleSetup, settingsCatalog } = await import(
  pathToFileURL(resolve(out, "fixture.mjs")).href
);
const setupMsgs = [
  { type: "catalog", data: settingsCatalog() },
  { type: "setup", data: sampleSetup() },
];
const promptsMsg = {
  type: "prompts",
  items: [
    ["Review this diff for bugs and missing tests. Point to exact lines.", 23, 0.3, 0],
    ["Run the tests, fix whatever fails, and explain each fix in one line", 17, 2, 0],
    [
      "[Pasted text #1 +290 lines] Here's the spec. Plan it first, then build it step by step",
      1,
      5,
      1,
    ],
    ["Commit, push and open a pull request with a short summary", 31, 26, 0],
    ["Explain this error and the smallest safe fix", 12, 30, 0],
    ["Write the release notes for 2.4 from the merged pull requests", 1, 60, 0],
  ].map(([text, count, hoursAgo, pastes], i) => ({
    id: String(i).padStart(12, "a"),
    text,
    count,
    first: now - 900 * H,
    last: now - hoursAgo * H,
    project: i % 2 ? "/Users/ana/code/api" : "/Users/ana/code/shop",
    sessionId: id(i + 1),
    pastes,
  })),
};
const detailsMsg = (chatId) => ({
  type: "chat:details",
  id: chatId,
  files: [
    {
      path: "/Users/ana/code/shop/src/checkout/cart.ts",
      name: "cart.ts",
      exists: true,
      createdByClaude: false,
      versions: [
        { version: 1, at: now - 3 * H, available: true, bytes: 18_400 },
        { version: 2, at: now - 2.5 * H, available: true, bytes: 18_400 },
        { version: 3, at: now - 2 * H, available: false, bytes: 0 },
      ],
    },
    {
      path: "/Users/ana/code/shop/src/checkout/lock.ts",
      name: "lock.ts",
      exists: true,
      createdByClaude: true,
      versions: [
        { version: 1, at: now - 2.8 * H, available: true, bytes: 18_400 },
        { version: 2, at: now - 2.2 * H, available: true, bytes: 18_400 },
      ],
    },
    {
      path: "/Users/ana/code/shop/README.md",
      name: "README.md",
      exists: false,
      createdByClaude: false,
      versions: [{ version: 1, at: now - 1 * H, available: true, bytes: 18_400 }],
    },
  ],
});
const hitsMsg = (req) => ({
  type: "search",
  req,
  done: true,
  hits: [
    {
      sessionId: id(1),
      snippet:
        "…the race happens when two tabs call checkout() at the same time, so we take a lock…",
      count: 4,
    },
    {
      sessionId: id(6),
      snippet: "…retry the webhook with the same idempotency key so checkout never charges twice…",
      count: 1,
    },
  ],
});
const usageMsg = {
  type: "usage",
  data: sampleUsage({
    quota: {
      enabled: true,
      shadowed: false,
      data: {
        v: 1,
        updatedAt: now - 120_000,
        sessionId: null,
        model: null,
        contextPct: null,
        costUsd: null,
        fiveHour: { pct: 38, resetsAt: now + 2.4 * H },
        sevenDay: { pct: 81, resetsAt: now + 3 * 24 * H },
        spendLimit: null,
      },
    },
  }),
};

for (const [name, vars] of Object.entries(themes)) {
  const css = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join("\n");
  writeFileSync(
    join(out, `${name}.html`),
    `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="codicon.css"><link rel="stylesheet" href="main.css">
<style>:root{${css}} body{width:340px;height:100vh;border-right:1px solid #8884}</style>
<script>
  window.__sent = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => { window.__sent.push(m); if (m.type === "ready") setTimeout(() => { const s = ${JSON.stringify(sample)}; if ((new URLSearchParams(location.search).get("t") || location.hash.slice(1)) === "welcome") s.onboarding.welcomed = false; window.postMessage(s, "*"); window.postMessage(${JSON.stringify(usageMsg)}, "*"); }, 0); if (m.type === "tab" && m.tab === "setup") setTimeout(() => { for (const x of ${JSON.stringify(setupMsgs)}) window.postMessage(x, "*"); }, 0); if (m.type === "tab" && m.tab === "prompts") setTimeout(() => window.postMessage(${JSON.stringify(promptsMsg)}, "*"), 0); if (m.type === "tab" && m.tab === "account") setTimeout(() => window.postMessage(${JSON.stringify(accountMsg)}, "*"), 0); if (m.type === "tab" && m.tab === "checkpoints") setTimeout(() => window.postMessage(${JSON.stringify(checkpointsMsg)}, "*"), 0); if (m.type === "setup:read") setTimeout(() => window.postMessage({ type: "setup:content", file: m.file, truncated: false, text: ["---", "name: sample", "description: A sample file for the preview", "---", "You are a focused reviewer.", "", "- Read the diff first.", "- Point to exact lines.", "- Keep it short.", ""].join(String.fromCharCode(10)) }, "*"), 0); if (m.type === "cp:files") { const d = ${JSON.stringify(detailsMsg("ID"))}; setTimeout(() => window.postMessage({ type: "cp:files", id: m.id, gone: m.id.startsWith("9f8e"), files: m.id.startsWith("9f8e") ? [] : d.files, orphans: m.id.startsWith("9f8e") ? 3 : 2 }, "*"), 0); } if (m.type === "chat:details") { const d = ${JSON.stringify(detailsMsg("ID"))}; d.id = m.id; setTimeout(() => window.postMessage(d, "*"), 0); } if (m.type === "search") { const h = ${JSON.stringify(hitsMsg("REQ"))}; h.req = m.req; setTimeout(() => window.postMessage(h, "*"), 0); } },
    getState: () => { const t = new URLSearchParams(location.search).get("t") || location.hash.slice(1); return t && t !== "welcome" ? { tab: t } : undefined; },
    setState: () => {},
  });
</script></head><body><div id="root"></div><script src="main.js"></script></body></html>`,
  );
}
console.log(`preview: ${out}/dark.html, ${out}/light.html`);
