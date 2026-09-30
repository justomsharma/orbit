import { describe, expect, it } from "vitest";
import type { AgentInfo } from "../agents";
import { checkHealth, closestKey, type HealthInput, hookScriptPath } from "../health";
import type { HookEntry } from "../hooks";
import type { JsonFile } from "../jsonFile";
import type { McpServer } from "../mcp";
import type { MemoryInfo } from "../memory";
import type { InstalledPlugin } from "../plugins";
import type { SettingsFile } from "../settings";
import type { SkillInfo } from "../skills";

const memory = (
  over: Partial<MemoryInfo["auto"]> = {},
  claudeMd: MemoryInfo["claudeMd"] = [],
): MemoryInfo => ({
  claudeMd,
  auto: {
    enabled: true,
    dir: "/m",
    indexPath: null,
    indexLines: 0,
    indexBytes: 0,
    files: [],
    ...over,
  },
});

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    settings: [],
    claudeJson: null,
    mcpJson: null,
    plugins: [],
    mcp: [],
    hooks: [],
    permissions: { rules: [], defaultMode: [], additionalDirectories: [] },
    skills: [],
    agents: [],
    commands: [],
    memory: memory(),
    missingCommands: new Set(),
    missingHookScripts: new Set(),
    ...over,
  };
}

const settings = (
  scope: SettingsFile["scope"],
  data: Record<string, unknown> | null,
  error: string | null = null,
  skipped: SettingsFile["skipped"] = null,
): SettingsFile => ({
  scope,
  path: `/${scope}/settings.json`,
  exists: true,
  data,
  error,
  skipped,
});

const jsonFile = (over: Partial<JsonFile>): JsonFile => ({
  path: "/h/.claude.json",
  exists: true,
  data: null,
  error: null,
  skipped: null,
  ...over,
});

const server = (over: Partial<McpServer>): McpServer => ({
  name: "db",
  scope: "user",
  source: "/h/.claude.json",
  plugin: null,
  transport: "stdio",
  command: "db-mcp",
  args: [],
  url: null,
  envKeys: [],
  headerKeys: [],
  approval: null,
  problem: null,
  ...over,
});

describe("checkHealth", () => {
  it("is quiet for a healthy setup", () => {
    expect(checkHealth(input())).toEqual([]);
  });

  it("flags a settings file Claude can't read, with a Fix-with-Claude prompt", () => {
    const [i] = checkHealth(
      input({
        settings: [
          settings("user", null, "Not valid JSON: trailing commas are not allowed (line 4)"),
        ],
      }),
    );
    expect(i).toMatchObject({ severity: "error", area: "settings", file: "/user/settings.json" });
    expect(i!.title).toMatch(/can't read your user settings/i);
    expect(i!.claudePrompt).toMatch(/trailing commas/);
  });

  it("says Orbit skipped a settings file too large to show, with nothing to fix", () => {
    const [i] = checkHealth(input({ settings: [settings("user", null, null, "too-large")] }));
    expect(i).toMatchObject({ severity: "info", area: "settings", claudePrompt: null, fix: null });
    expect(i!.title).toBe("Orbit skipped your user settings");
    expect(i!.detail).toMatch(/larger than 4 MB/);
    expect(i!.detail).not.toMatch(/ignores/);
  });

  it("warns when a settings file can't be opened, without asking Claude to fix JSON", () => {
    const [i] = checkHealth(input({ settings: [settings("local", null, null, "unreadable")] }));
    expect(i).toMatchObject({ severity: "warning", area: "settings", claudePrompt: null });
    expect(i!.title).toMatch(/couldn't open your local project settings/);
  });

  it("says Orbit skipped a huge ~/.claude.json instead of calling its servers broken", () => {
    const [i] = checkHealth(input({ claudeJson: jsonFile({ skipped: "too-large" }) }));
    expect(i).toMatchObject({ severity: "info", area: "mcp", claudePrompt: null, fix: null });
    expect(i!.title).toBe("Orbit skipped ~/.claude.json");
    expect(i!.detail).toBe(
      "It is larger than 32 MB, so MCP servers listed there aren't shown here. Claude Code isn't affected.",
    );
  });

  it("keeps the error and Fix with Claude for a ~/.claude.json that doesn't parse", () => {
    const [i] = checkHealth(
      input({
        claudeJson: jsonFile({ error: "Not valid JSON: syntax error at line 3, column 1" }),
      }),
    );
    expect(i).toMatchObject({ severity: "error", area: "mcp" });
    expect(i!.claudePrompt).toMatch(/fix the JSON/);
  });

  it("suggests the right name for a mistyped setting", () => {
    const [i] = checkHealth(input({ settings: [settings("user", { thme: "dark" })] }));
    expect(i).toMatchObject({ severity: "warning", area: "settings" });
    expect(i!.title).toContain("thme");
    expect(i!.detail).toContain('Did you mean "theme"?');
  });

  it("knows documented settings the published schema is missing (no false alarm)", () => {
    expect(checkHealth(input({ settings: [settings("user", { modelSettings: {} })] }))).toEqual([]);
  });

  it("treats an unknown setting that isn't a near miss as a gentle tip, not a warning", () => {
    const [i] = checkHealth(input({ settings: [settings("user", { brandNewFeatureFlag: true })] }));
    expect(i).toMatchObject({ severity: "info" });
    expect(i!.detail).toMatch(/newer than Orbit's list/);
  });

  it("explains an MCP server that can't start because its command is missing", () => {
    const [i] = checkHealth(input({ mcp: [server({})], missingCommands: new Set(["db-mcp"]) }));
    expect(i).toMatchObject({ severity: "error", area: "mcp" });
    expect(i!.title).toMatch(/db.*can't start/);
  });

  it("offers to approve a project MCP server waiting for approval", () => {
    const [i] = checkHealth(input({ mcp: [server({ scope: "project", approval: "pending" })] }));
    expect(i).toMatchObject({ severity: "info", fix: { kind: "approveMcp", name: "db" } });
  });

  it("warns about a plugin that is enabled but not installed", () => {
    const p = { id: "x@m", name: "x", problem: "Enabled but not installed" } as InstalledPlugin;
    expect(checkHealth(input({ plugins: [p] }))[0]).toMatchObject({
      severity: "warning",
      area: "plugins",
    });
  });

  it("flags a hook whose script doesn't exist", () => {
    const h = {
      id: "h1",
      event: "Stop",
      command: "./scripts/notify.sh",
      source: "/p/.claude/settings.json",
      scope: "project",
    } as HookEntry;
    const [i] = checkHealth(input({ hooks: [h], missingHookScripts: new Set(["h1"]) }));
    expect(i).toMatchObject({ severity: "error", area: "hooks", file: "/p/.claude/settings.json" });
  });

  it("warns about permissions that remove every safety prompt", () => {
    const issues = checkHealth(
      input({
        permissions: {
          rules: [{ scope: "user", list: "allow", rule: "Bash" }],
          defaultMode: [{ scope: "user", mode: "bypassPermissions" }],
          additionalDirectories: [],
        },
      }),
    );
    expect(issues.map((i) => i.title)).toEqual([
      expect.stringMatching(/every shell command/i),
      expect.stringMatching(/bypass/i),
    ]);
  });

  it("passes on problems found in skills and agents", () => {
    const s = {
      name: "deploy",
      scope: "project",
      file: "/w/SKILL.md",
      problems: ["No description — Claude won't know when to use it"],
    } as SkillInfo;
    const a = {
      name: "rev",
      scope: "user",
      file: "/a.md",
      problems: ["Unknown model 'gpt'"],
    } as AgentInfo;
    expect(checkHealth(input({ skills: [s], agents: [a] })).map((i) => i.area)).toEqual([
      "skills",
      "agents",
    ]);
  });

  it("warns when MEMORY.md is too long for Claude to read in full", () => {
    const [i] = checkHealth(
      input({ memory: memory({ indexPath: "/m/MEMORY.md", indexLines: 260, indexBytes: 12_000 }) }),
    );
    expect(i!.title).toMatch(/first 200 lines/);
  });

  it("points out broken CLAUDE.md imports and memory links", () => {
    const issues = checkHealth(
      input({
        memory: memory(
          {
            files: [
              {
                name: "a.md",
                path: "/m/a.md",
                bytes: 1,
                title: "a",
                description: null,
                links: ["gone"],
                brokenLinks: ["gone"],
                orphan: false,
              },
            ],
          },
          [
            {
              scope: "project",
              path: "/w/CLAUDE.md",
              exists: true,
              bytes: 10,
              imports: [{ ref: "@docs/x.md", path: "/w/docs/x.md", exists: false }],
            },
          ],
        ),
      }),
    );
    expect(issues.map((i) => i.severity)).toEqual(["warning", "info"]);
  });

  it("orders errors before warnings before tips", () => {
    const issues = checkHealth(
      input({
        mcp: [
          server({ scope: "project", approval: "pending", command: "ok-mcp" }),
          server({ name: "b" }),
        ],
        missingCommands: new Set(["db-mcp"]),
        settings: [settings("user", { thme: 1 })],
      }),
    );
    expect(issues.map((i) => i.severity)).toEqual(["error", "warning", "info"]);
  });
});

describe("closestKey", () => {
  it("finds a near miss and ignores unrelated words", () => {
    expect(closestKey("efortLevel")).toBe("effortLevel");
    expect(closestKey("zzzzzzzz")).toBeNull();
  });
});

describe("hookScriptPath", () => {
  const ws = "/w";
  const home = "/home/a";
  it.each([
    ["./scripts/notify.sh", "/w/scripts/notify.sh"],
    ['"$CLAUDE_PROJECT_DIR/hooks/check.sh" --fast', "/w/hooks/check.sh"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell syntax under test
    ["${CLAUDE_PROJECT_DIR}/hooks/check.sh", "/w/hooks/check.sh"],
    ["~/bin/done.sh", "/home/a/bin/done.sh"],
    ["bash ./x.sh", "/w/x.sh"],
    ["node hooks/log.js arg", "/w/hooks/log.js"],
    ["npx prettier --write", null],
    ["jq -r .tool_name", null],
    ["echo hi", null],
  ])("%s → %s", (cmd, want) => {
    const got = hookScriptPath(cmd, ws, home);
    expect(got === null ? null : got.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "")).toBe(want);
  });
});
