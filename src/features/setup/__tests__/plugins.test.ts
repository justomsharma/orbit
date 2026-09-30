import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { readPlugins } from "../plugins";
import { pluginDir, put, settingsOf, writeInstalled } from "./configFixture";

const tmp = useTmpDir();

const ZERO = { skills: 0, agents: 0, commands: 0, hooks: 0, mcpServers: 0 };

describe("readPlugins", () => {
  it("returns [] when nothing is installed or enabled", async () => {
    expect(await readPlugins(tmp(), [], null)).toEqual([]);
  });

  it("reads a user plugin with its manifest and components", async () => {
    const home = tmp();
    const dir = pluginDir(home, "review-kit");
    put(join(dir, ".claude-plugin", "plugin.json"), {
      name: "review-kit",
      description: "Code review helpers",
      version: "1.2.0",
      mcpServers: { linter: { command: "npx", args: ["lint-mcp"] } },
    });
    put(join(dir, "skills", "review", "SKILL.md"), "---\nname: review\n---\n");
    put(join(dir, "skills", "explain", "SKILL.md"), "---\nname: explain\n---\n");
    mkdirSync(join(dir, "skills", "empty-folder"), { recursive: true });
    put(join(dir, "skills", "README.md"), "not a skill");
    put(join(dir, "agents", "reviewer.md"), "---\nname: reviewer\n---\n");
    put(join(dir, "agents", "tester.md"), "---\nname: tester\n---\n");
    put(join(dir, "agents", "notes.txt"), "not an agent");
    put(join(dir, "commands", "review.md"), "Review $ARGUMENTS");
    put(join(dir, "commands", "git", "pr.md"), "Open a PR");
    put(join(dir, "commands", "git", "deep", "squash.md"), "Squash");
    put(join(dir, "hooks", "hooks.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "a" },
              { type: "command", command: "b" },
            ],
          },
        ],
        Stop: [{ hooks: [{ type: "prompt", prompt: "c" }] }],
      },
    });
    put(join(dir, ".mcp.json"), {
      mcpServers: { github: { type: "http", url: "https://mcp.x.dev" } },
    });
    writeInstalled(home, {
      "review-kit@official": [{ scope: "user", installPath: dir, version: "1.2.0" }],
    });
    const [p, ...rest] = await readPlugins(
      home,
      [settingsOf("user", { enabledPlugins: { "review-kit@official": true } })],
      null,
    );
    expect(rest).toEqual([]);
    expect(p).toEqual({
      id: "review-kit@official",
      name: "review-kit",
      marketplace: "official",
      scope: "user",
      projectPath: null,
      installPath: dir,
      version: "1.2.0",
      description: "Code review helpers",
      enabled: true,
      enabledIn: ["user"],
      counts: { skills: 2, agents: 2, commands: 3, hooks: 3, mcpServers: 2 },
      problem: null,
    });
  });

  it("keeps user installs and installs for this folder only", async () => {
    const home = tmp();
    const ws = tmp();
    const a = pluginDir(home, "a");
    const b = pluginDir(home, "b");
    const c = pluginDir(home, "c");
    const d = pluginDir(home, "d");
    writeInstalled(home, {
      "a@m": [{ scope: "user", installPath: a }],
      "b@m": [{ scope: "project", installPath: b, projectPath: ws }],
      "c@m": [{ scope: "local", installPath: c, projectPath: join(ws, "..", "other-project") }],
      "d@m": [
        { scope: "local", installPath: d, projectPath: ws },
        { scope: "project", installPath: d, projectPath: join(ws, "..", "elsewhere") },
      ],
    });
    const list = await readPlugins(home, [], ws);
    expect(list.map((p) => [p.id, p.scope, p.projectPath])).toEqual([
      ["a@m", "user", null],
      ["b@m", "project", ws],
      ["d@m", "local", ws],
    ]);
    expect(list.every((p) => p.enabled === false && p.problem === null)).toBe(true);
  });

  it("drops project installs when no folder is open", async () => {
    const home = tmp();
    writeInstalled(home, {
      "b@m": [{ scope: "project", installPath: pluginDir(home, "b"), projectPath: tmp() }],
    });
    expect(await readPlugins(home, [], null)).toEqual([]);
  });

  it("matches Windows project paths regardless of case and slashes", async () => {
    const home = tmp();
    const dir = pluginDir(home, "b");
    writeInstalled(home, {
      "b@m": [{ scope: "project", installPath: dir, projectPath: "c:/Code/App" }],
    });
    const list = await readPlugins(home, [], "C:\\code\\app\\", "win32");
    expect(list.map((p) => p.id)).toEqual(["b@m"]);
    expect(await readPlugins(home, [], "C:\\code\\other", "win32")).toEqual([]);
  });

  it("is case-sensitive on Linux", async () => {
    const home = tmp();
    writeInstalled(home, {
      "b@m": [{ scope: "project", installPath: pluginDir(home, "b"), projectPath: "/Code/App" }],
    });
    expect(await readPlugins(home, [], "/code/app", "linux")).toEqual([]);
    expect(await readPlugins(home, [], "/Code/App/", "linux")).toHaveLength(1);
  });

  it("decides enabled by precedence: managed > local > project > user", async () => {
    const home = tmp();
    writeInstalled(home, {
      "a@m": [{ scope: "user", installPath: pluginDir(home, "a") }],
      "b@m": [{ scope: "user", installPath: pluginDir(home, "b") }],
      "c@m": [{ scope: "user", installPath: pluginDir(home, "c") }],
      "d@m": [{ scope: "user", installPath: pluginDir(home, "d") }],
    });
    const settings = [
      settingsOf("user", {
        env: { API_KEY: "sk-secret-123" },
        enabledPlugins: { "a@m": true, "b@m": true, "c@m": false },
      }),
      settingsOf("project", { enabledPlugins: { "b@m": true, "c@m": true } }),
      settingsOf("local", { enabledPlugins: { "a@m": false, "c@m": "yes" } }),
      settingsOf("managed", { enabledPlugins: { "b@m": false } }),
    ];
    const list = await readPlugins(home, settings, tmp());
    const byId = Object.fromEntries(list.map((p) => [p.id, [p.enabled, p.enabledIn]]));
    expect(byId).toEqual({
      "a@m": [false, ["user"]],
      "b@m": [false, ["user", "project"]],
      "c@m": [true, ["project"]],
      "d@m": [false, []],
    });
    expect(JSON.stringify(list)).not.toContain("sk-secret-123");
  });

  it("lists plugins enabled in settings but not installed", async () => {
    const home = tmp();
    writeInstalled(home, { "a@m": [{ scope: "user", installPath: pluginDir(home, "a") }] });
    const list = await readPlugins(
      home,
      [
        settingsOf("user", { enabledPlugins: { "a@m": true, "gone@m": false } }),
        settingsOf("project", { enabledPlugins: { "ghost@my@mkt": true } }),
      ],
      tmp(),
    );
    expect(list.map((p) => p.id)).toEqual(["a@m", "ghost@my@mkt"]);
    expect(list[1]).toEqual({
      id: "ghost@my@mkt",
      name: "ghost@my",
      marketplace: "mkt",
      scope: "user",
      projectPath: null,
      installPath: "",
      version: "",
      description: null,
      enabled: true,
      enabledIn: ["project"],
      counts: ZERO,
      problem: "Enabled but not installed",
    });
  });

  it("reports a plugin whose folder is gone", async () => {
    const home = tmp();
    writeInstalled(home, { "a@m": [{ scope: "user", installPath: join(home, "missing") }] });
    const [p] = await readPlugins(home, [], null);
    expect(p).toMatchObject({ id: "a@m", problem: "Plugin files are missing", counts: ZERO });
  });

  it("tolerates a broken or odd installed_plugins.json", async () => {
    const home = tmp();
    const file = join(home, "plugins", "installed_plugins.json");
    put(file, "{ // nope");
    expect(await readPlugins(home, [], null)).toEqual([]);
    put(file, "[]");
    expect(await readPlugins(home, [], null)).toEqual([]);
    put(file, { version: 2, plugins: { "a@m": "x", "b@m": [null, 3, { scope: "user" }] } });
    const list = await readPlugins(home, [], null);
    expect(list).toEqual([
      expect.objectContaining({ id: "b@m", installPath: "", problem: "Plugin files are missing" }),
    ]);
  });

  it("reads the legacy flat shape", async () => {
    const home = tmp();
    const dir = pluginDir(home, "a");
    put(join(home, "plugins", "installed_plugins.json"), {
      "a@m": { version: "0.9.0", installPath: dir, installedAt: "2025-01-01T00:00:00Z" },
    });
    const [p] = await readPlugins(home, [], null);
    expect(p).toMatchObject({ id: "a@m", scope: "user", installPath: dir, version: "0.9.0" });
  });

  it("reports a broken manifest", async () => {
    const home = tmp();
    const dir = pluginDir(home, "a");
    put(join(dir, ".claude-plugin", "plugin.json"), "{ nope");
    writeInstalled(home, { "a@m": [{ scope: "user", installPath: dir }] });
    const [p] = await readPlugins(home, [], null);
    expect(p!.problem).toMatch(/^Plugin manifest: Not valid JSON/);
    expect(p!.description).toBeNull();
  });
});
