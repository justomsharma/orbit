import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import type { ConfirmHost } from "../../core/applyEdit";
import { SafeWriter } from "../../core/safeWriter";
import { handleSetup, type SetupHandlerDeps } from "../setupHandler";
import { SetupService } from "../setupService";

const tmp = useTmpDir();

async function setup(opts: { workspace?: boolean; settings?: object } = {}) {
  const root = tmp();
  const home = join(root, ".claude");
  const ws = join(root, "shop");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(ws, ".claude"), { recursive: true });
  writeFileSync(
    join(home, "settings.json"),
    JSON.stringify(
      opts.settings ?? {
        theme: "dark",
        hooks: { Stop: [{ hooks: [{ type: "command", command: "done.sh" }] }] },
      },
      null,
      2,
    ),
  );
  const claudeJson = join(root, ".claude.json");
  writeFileSync(
    claudeJson,
    JSON.stringify({
      numStartups: 1,
      projects: { [ws]: { mcpServers: { db: { command: "db" } } } },
    }),
  );
  const log: string[] = [];
  const confirm: ConfirmHost = {
    confirm: async (s) => {
      log.push(`confirm ${s}`);
      return "apply";
    },
    showDiff: async () => {},
    done: async () => {},
    warn: (m) => {
      log.push(`warn ${m}`);
    },
  };
  const service = new SetupService({
    home,
    claudeJson,
    userHome: root,
    platform: process.platform,
    commandExists: async () => true,
  });
  const workspace = opts.workspace === false ? null : ws;
  const snap = await service.snapshot(workspace);
  const deps: SetupHandlerDeps = {
    home,
    claudeJson,
    workspace: () => workspace,
    platform: process.platform,
    writer: new SafeWriter(join(root, "backups")),
    confirm,
    snapshot: () => snap,
    refresh: async () => {
      log.push("refresh");
    },
    openFile: async (f) => {
      log.push(`open ${f}`);
    },
    runClaude: async (args) => {
      log.push(`claude ${args.join(" ")}`);
    },
    newChat: async (prompt) => {
      log.push(`chat ${prompt}`);
    },
  };
  const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  return {
    root,
    home,
    ws,
    claudeJson,
    deps,
    log,
    json,
    handle: (m: object) => handleSetup(m, deps),
  };
}

describe("handleSetup: settings", () => {
  it("sets a setting in the chosen scope after asking", async () => {
    const { handle, home, json, log } = await setup();
    await handle({ type: "setup:setSetting", scope: "user", key: "theme", value: "light" });
    expect(json(join(home, "settings.json")).theme).toBe("light");
    expect(log[0]).toMatch(/^confirm .*Theme.*"light".*user settings/);
  });

  it("resets a setting to Claude's default with null", async () => {
    const { handle, home, json } = await setup();
    await handle({ type: "setup:setSetting", scope: "user", key: "theme", value: null });
    expect(json(join(home, "settings.json")).theme).toBeUndefined();
  });

  it.each([
    [{ key: "notARealSetting", value: true }, /isn't a Claude Code setting/],
    [{ key: "allowManagedHooksOnly", value: true }, /organisation/],
    [{ key: "effortLevel", value: "ultra" }, /isn't one of/],
    [{ key: "autoMemoryEnabled", value: "yes" }, /on or off/],
  ])("refuses %j", async (m, why) => {
    const { handle, log } = await setup();
    await handle({ type: "setup:setSetting", scope: "user", ...m });
    expect(log[0]).toMatch(why);
  });

  it("needs an open folder for project settings", async () => {
    const { handle, log } = await setup({ workspace: false });
    await handle({ type: "setup:setSetting", scope: "project", key: "theme", value: "dark" });
    expect(log[0]).toMatch(/Open a folder/);
  });
});

describe("handleSetup: plugins, MCP, hooks, permissions, skills", () => {
  it("turns a plugin off", async () => {
    const { handle, home, json } = await setup();
    await handle({ type: "setup:plugin", id: "x@m", enabled: false, scope: "user" });
    expect(json(join(home, "settings.json")).enabledPlugins).toEqual({ "x@m": false });
  });

  it("approves a project MCP server in the local settings file", async () => {
    const { handle, ws, json } = await setup();
    await handle({ type: "setup:mcpApproval", name: "db", state: "approved" });
    expect(json(join(ws, ".claude", "settings.local.json")).enabledMcpjsonServers).toEqual(["db"]);
  });

  it("removes a local MCP server from ~/.claude.json, keeping everything else", async () => {
    const { handle, claudeJson, json, ws } = await setup();
    await handle({ type: "setup:mcpRemove", scope: "local", name: "db" });
    expect(json(claudeJson)).toEqual({ numStartups: 1, projects: { [ws]: { mcpServers: {} } } });
  });

  it("adds a stdio server to the project and an http server for the user", async () => {
    const { handle, ws, claudeJson, json } = await setup();
    await handle({
      type: "setup:mcpAdd",
      scope: "project",
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "srv"],
    });
    await handle({
      type: "setup:mcpAdd",
      scope: "user",
      name: "gh",
      transport: "http",
      url: "https://api.x/mcp",
    });
    expect(json(join(ws, ".mcp.json")).mcpServers.fs).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "srv"],
    });
    expect(json(claudeJson).mcpServers.gh).toEqual({ type: "http", url: "https://api.x/mcp" });
  });

  it("asks Claude's own CLI to log in to an MCP server", async () => {
    const { handle, log } = await setup();
    await handle({ type: "setup:mcpLogin", name: "gh" });
    expect(log).toContain("claude mcp login gh");
  });

  it("removes a hook by its id", async () => {
    const { handle, deps, home, json } = await setup();
    const id = deps.snapshot()!.hooks[0]!.id;
    await handle({ type: "setup:hookRemove", id });
    expect(json(join(home, "settings.json")).hooks).toBeUndefined();
  });

  it("refuses a hook for an event Claude doesn't have", async () => {
    const { handle, log } = await setup();
    await handle({
      type: "setup:hookAdd",
      scope: "user",
      event: "OnLunch",
      matcher: null,
      command: "x",
    });
    expect(log[0]).toMatch(/isn't a Claude Code hook event/);
  });

  it("adds a hook and can pause all hooks", async () => {
    const { handle, home, json } = await setup();
    await handle({
      type: "setup:hookAdd",
      scope: "user",
      event: "SessionStart",
      matcher: null,
      command: "hi.sh",
    });
    await handle({ type: "setup:hooksPaused", paused: true });
    const s = json(join(home, "settings.json"));
    expect(s.hooks.SessionStart[0].hooks[0].command).toBe("hi.sh");
    expect(s.disableAllHooks).toBe(true);
  });

  it("adds and removes a permission rule", async () => {
    const { handle, home, json } = await setup();
    await handle({
      type: "setup:rule",
      op: "add",
      scope: "user",
      list: "allow",
      rule: "Bash(npm test)",
    });
    expect(json(join(home, "settings.json")).permissions.allow).toEqual(["Bash(npm test)"]);
    await handle({
      type: "setup:rule",
      op: "remove",
      scope: "user",
      list: "allow",
      rule: "Bash(npm test)",
    });
    expect(json(join(home, "settings.json")).permissions.allow).toEqual([]);
  });

  it("hides a skill from Claude", async () => {
    const { handle, home, json } = await setup();
    await handle({ type: "setup:skillVisibility", name: "deploy", visibility: "off" });
    expect(json(join(home, "settings.json")).skillOverrides).toEqual({ deploy: "off" });
  });
});

describe("handleSetup: toggles change the file that decides them", () => {
  const put = (p: string, o: object) => writeFileSync(p, JSON.stringify(o, null, 2));

  it("overrides a plugin the shared project settings turn off in this folder's local file", async () => {
    const { handle, ws, home, json, log } = await setup({ settings: {} });
    put(join(ws, ".claude", "settings.json"), { enabledPlugins: { "x@m": false } });
    await handle({ type: "setup:plugin", id: "x@m", enabled: true, scope: "auto" });
    expect(json(join(ws, ".claude", "settings.local.json")).enabledPlugins).toEqual({
      "x@m": true,
    });
    expect(json(join(home, "settings.json"))).toEqual({});
    expect(log[0]).toMatch(/local project settings/);
  });

  it("changes a plugin in the file that already decides it", async () => {
    const { handle, ws, json } = await setup({ settings: {} });
    put(join(ws, ".claude", "settings.local.json"), { enabledPlugins: { "x@m": true } });
    await handle({ type: "setup:plugin", id: "x@m", enabled: false, scope: "auto" });
    expect(json(join(ws, ".claude", "settings.local.json")).enabledPlugins).toEqual({
      "x@m": false,
    });
  });

  it("un-pauses hooks with an explicit off when another file still pauses them", async () => {
    const { handle, ws, home, json } = await setup({ settings: { disableAllHooks: true } });
    put(join(ws, ".claude", "settings.json"), { disableAllHooks: true });
    await handle({ type: "setup:hooksPaused", paused: false });
    expect(json(join(ws, ".claude", "settings.local.json")).disableAllHooks).toBe(false);
    expect(json(join(home, "settings.json")).disableAllHooks).toBe(true);
  });

  it("un-pauses by removing the key when nothing else pauses hooks", async () => {
    const { handle, home, json } = await setup({ settings: { disableAllHooks: true } });
    await handle({ type: "setup:hooksPaused", paused: false });
    expect(json(join(home, "settings.json")).disableAllHooks).toBeUndefined();
  });

  it("sets the default mode where it is decided", async () => {
    const { handle, ws, json } = await setup({ settings: {} });
    put(join(ws, ".claude", "settings.json"), { permissions: { defaultMode: "plan" } });
    await handle({
      type: "setup:setSetting",
      scope: "auto",
      key: "permissions.defaultMode",
      value: "acceptEdits",
    });
    expect(json(join(ws, ".claude", "settings.local.json")).permissions.defaultMode).toBe(
      "acceptEdits",
    );
  });

  it("shows a skill again even when another file hides it", async () => {
    const { handle, ws, json } = await setup({ settings: {} });
    put(join(ws, ".claude", "settings.json"), { skillOverrides: { deploy: "off" } });
    await handle({ type: "setup:skillVisibility", name: "deploy", visibility: "on" });
    expect(json(join(ws, ".claude", "settings.local.json")).skillOverrides).toEqual({
      deploy: "on",
    });
  });

  it("accepts Claude's user-invocable-only skill setting", async () => {
    const { handle, home, json } = await setup({ settings: {} });
    await handle({
      type: "setup:skillVisibility",
      name: "deploy",
      visibility: "user-invocable-only",
    });
    expect(json(join(home, "settings.json")).skillOverrides).toEqual({
      deploy: "user-invocable-only",
    });
  });

  it("approving a project server also lifts a rejection in your user settings", async () => {
    const { handle, ws, home, json, log } = await setup({
      settings: { disabledMcpjsonServers: ["db", "other"] },
    });
    await handle({ type: "setup:mcpApproval", name: "db", state: "approved" });
    expect(json(join(ws, ".claude", "settings.local.json")).enabledMcpjsonServers).toEqual(["db"]);
    expect(json(join(home, "settings.json")).disabledMcpjsonServers).toEqual(["other"]);
    expect(log.filter((l) => l.startsWith("confirm"))).toHaveLength(2);
  });

  it("says plainly when the shared project settings reject a server", async () => {
    const { handle, ws, json, log } = await setup({ settings: {} });
    put(join(ws, ".claude", "settings.json"), { disabledMcpjsonServers: ["db"] });
    await handle({ type: "setup:mcpApproval", name: "db", state: "approved" });
    expect(log.find((l) => l.includes("shared project settings"))).toMatch(/^confirm .*everyone/);
    expect(json(join(ws, ".claude", "settings.json")).disabledMcpjsonServers).toEqual([]);
  });
});

describe("handleSetup: files and Claude", () => {
  it("creates a new skill and opens it", async () => {
    const { handle, home, log } = await setup();
    await handle({
      type: "setup:new",
      kind: "skill",
      scope: "user",
      name: "notes",
      description: "Write notes",
    });
    const file = join(home, "skills", "notes", "SKILL.md");
    expect(readFileSync(file, "utf8")).toMatch(/name: notes/);
    expect(log).toContain(`open ${file}`);
  });

  it("won't overwrite an existing skill", async () => {
    const { handle, home, log } = await setup();
    mkdirSync(join(home, "skills", "notes"), { recursive: true });
    writeFileSync(join(home, "skills", "notes", "SKILL.md"), "mine");
    await handle({
      type: "setup:new",
      kind: "skill",
      scope: "user",
      name: "notes",
      description: "x",
    });
    expect(readFileSync(join(home, "skills", "notes", "SKILL.md"), "utf8")).toBe("mine");
    expect(log.join("\n")).toMatch(/already exists/);
  });

  it("creates the project CLAUDE.md", async () => {
    const { handle, ws } = await setup();
    await handle({ type: "setup:createClaudeMd", scope: "project" });
    expect(existsSync(join(ws, "CLAUDE.md"))).toBe(true);
  });

  it("opens only files Orbit showed", async () => {
    const { handle, home, log, root } = await setup();
    await handle({ type: "setup:open", file: join(home, "settings.json") });
    await handle({ type: "setup:open", file: join(root, "secret.txt") });
    expect(log).toEqual([`open ${join(home, "settings.json")}`]);
  });

  it("asks Claude to fix an issue with the issue's own prompt", async () => {
    const { handle, deps, log } = await setup({ settings: { thme: "x" } });
    const issue = deps.snapshot()!.issues.find((i) => i.claudePrompt)!;
    await handle({ type: "setup:fixWithClaude", issueId: issue.id });
    expect(log).toContain(`chat ${issue.claudePrompt}`);
  });

  it("ignores messages that aren't setup messages", async () => {
    const { handle } = await setup();
    expect(await handle({ type: "refresh" })).toBe(false);
  });
});
