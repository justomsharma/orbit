import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import type { ConfirmHost } from "../../core/applyEdit";
import { SafeWriter } from "../../core/safeWriter";
import { Trash } from "../../core/trash";
import type { PausedHook, PausedStore } from "../../features/setup/pausedHooks";
import { redactText, redactUrl } from "../../features/setup/redact";
import type { HostMsg } from "../../shared/protocol";
import { handleSetup, type SetupHandlerDeps } from "../setupHandler";
import { SetupService } from "../setupService";

const tmp = useTmpDir();

async function setup(
  opts: {
    workspace?: boolean;
    settings?: object;
    platform?: NodeJS.Platform;
    content?: boolean;
    answer?: "apply" | "cancel";
  } = {},
) {
  const root = tmp();
  const home = join(root, ".claude");
  const ws = join(root, "shop");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(ws, ".claude"), { recursive: true });
  if (opts.content) {
    mkdirSync(join(home, "skills", "notes", "scripts"), { recursive: true });
    writeFileSync(
      join(home, "skills", "notes", "SKILL.md"),
      "---\nname: notes\ndescription: Take notes\n---\nWrite it down.\n",
    );
    writeFileSync(join(home, "skills", "notes", "scripts", "x.sh"), "echo\n");
    mkdirSync(join(home, "commands"), { recursive: true });
    writeFileSync(join(home, "commands", "ship.md"), "---\ndescription: Ship it\n---\nShip.\n");
    mkdirSync(join(home, "agents"), { recursive: true });
    writeFileSync(
      join(home, "agents", "helper.md"),
      "---\nname: helper\ncolor: green\ndescription: Helps\nmodel: haiku\n---\nHelp.\n",
    );
  }
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
  const replies: [string, boolean][] = [];
  const undos: (() => Promise<boolean>)[] = [];
  const posted: unknown[] = [];
  const confirm: ConfirmHost = {
    confirm: async (s, warning) => {
      log.push(`confirm ${s}${warning ? ` ⚠ ${warning}` : ""}`);
      return opts.answer ?? "apply";
    },
    showDiff: async () => {},
    done: async (label, undo) => {
      log.push(`done ${label}`);
      undos.push(undo);
    },
    warn: (m) => {
      log.push(`warn ${m}`);
    },
  };
  let pausedList: PausedHook[] = [];
  const paused: PausedStore = {
    list: async () => pausedList,
    add: async (h) => {
      const e = { ...h, id: randomUUID(), at: 1 };
      pausedList = [...pausedList, e];
      return e;
    },
    remove: async (id) => {
      pausedList = pausedList.filter((p) => p.id !== id);
    },
  };
  const service = new SetupService({
    home,
    claudeJson,
    userHome: root,
    platform: process.platform,
    commandExists: async () => true,
    pausedHooks: () => paused.list(),
  });
  const workspace = opts.workspace === false ? null : ws;
  let snap = await service.snapshot(workspace);
  const deps: SetupHandlerDeps = {
    home,
    claudeJson,
    workspace: () => workspace,
    platform: opts.platform ?? "linux",
    writer: new SafeWriter(join(root, "backups")),
    confirm,
    snapshot: () => snap,
    refresh: async () => {
      log.push("refresh");
      snap = await service.snapshot(workspace);
    },
    openFile: async (f) => {
      log.push(`open ${f}`);
    },
    reveal: async (f) => {
      log.push(`reveal ${f}`);
    },
    runClaude: async (args) => {
      log.push(`claude ${args.join(" ")}`);
    },
    newChat: async (prompt) => {
      log.push(`chat ${prompt}`);
    },
    reply: (req, ok) => {
      replies.push([req, ok]);
    },
    trash: new Trash(join(root, "trash")),
    paused,
    otherMemory: { files: [] },
    post: (m) => posted.push(m),
  };
  const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  return {
    root,
    home,
    ws,
    claudeJson,
    deps,
    log,
    replies,
    undos,
    posted,
    paused,
    snapshot: () => snap,
    json,
    handle: (m: object) => handleSetup(m, deps),
  };
}

describe("handleSetup: history", () => {
  it("lists Orbit's changes and its trash, newest first, and undoes a change", async () => {
    const { handle, posted, home, json } = await setup({ content: true });
    await handle({ type: "setup:setSetting", scope: "user", key: "effortLevel", value: "high" });
    await handle({ type: "setup:trash", file: join(home, "commands", "ship.md") });
    await handle({ type: "history:list" });
    const h = posted.find((m) => (m as { type: string }).type === "history") as Extract<
      HostMsg,
      { type: "history" }
    >;
    expect(h.edits.map((e) => e.label)).toEqual(["Effort level: high"]);
    expect(h.trash.map((t) => t.label)).toEqual(["Deleted command /ship"]);
    await handle({ type: "history:undo", id: h.edits[0]!.id });
    expect(json(join(home, "settings.json")).effortLevel).toBeUndefined();
    await handle({ type: "history:restore", id: h.trash[0]!.id });
    expect(existsSync(join(home, "commands", "ship.md"))).toBe(true);
  });

  it("deletes something in the trash for good only after asking", async () => {
    const { handle, posted, home, log } = await setup({ content: true });
    await handle({ type: "setup:trash", file: join(home, "commands", "ship.md") });
    await handle({ type: "history:list" });
    const h = posted.find((m) => (m as { type: string }).type === "history") as Extract<
      HostMsg,
      { type: "history" }
    >;
    await handle({ type: "history:forget", id: h.trash[0]!.id });
    expect(log.some((l) => /^confirm Delete .*for good/.test(l))).toBe(true);
  });
});

describe("handleSetup: other projects' memories", () => {
  it("reads another project's memories, then lets them be opened and deleted", async () => {
    const { handle, posted, home, log, undos } = await setup();
    const dir = join(home, "projects", "C--code-api", "memory");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "api.md"), "---\nname: api\n---\nThe API.\n");
    await handle({ type: "setup:memoryOf", slug: "C--code-api" });
    expect(posted[0]).toMatchObject({ type: "setup:memoryFiles", slug: "C--code-api" });
    const file = join(dir, "api.md");
    await handle({ type: "setup:open", file });
    await handle({ type: "setup:revealFile", file });
    expect(log).toEqual([`open ${file}`, `reveal ${file}`]);
    await handle({ type: "setup:trash", file });
    expect(existsSync(file)).toBe(false);
    expect(await undos[0]!()).toBe(true);
    expect(existsSync(file)).toBe(true);
  });

  it("answers an unknown project with nothing", async () => {
    const { handle, posted } = await setup();
    await handle({ type: "setup:memoryOf", slug: "nope" });
    expect(posted).toEqual([{ type: "setup:memoryFiles", slug: "nope", files: [] }]);
  });
});

describe("handleSetup: edits never save hidden secrets", () => {
  const SECRET = 'curl -H "Authorization: Bearer abcdef0123456789abcdef" https://x/hook';

  it("keeps a hook's real command when only its time limit changed", async () => {
    const { handle, json, home, snapshot } = await setup({
      settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: SECRET }] }] } },
    });
    const h = snapshot().hooks[0]!;
    await handle({
      type: "setup:hookEdit",
      req: "m1",
      id: h.id,
      scope: "user",
      event: "Stop",
      matcher: null,
      command: redactText(SECRET),
      timeout: 30,
    });
    expect(json(join(home, "settings.json")).hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: SECRET,
      timeout: 30,
    });
  });

  it("refuses a command that still has a hidden part but was changed", async () => {
    const { handle, json, home, snapshot, log } = await setup({
      settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: SECRET }] }] } },
    });
    await handle({
      type: "setup:hookEdit",
      req: "m2",
      id: snapshot().hooks[0]!.id,
      scope: "user",
      event: "Stop",
      matcher: null,
      command: `${redactText(SECRET)} --verbose`,
      timeout: null,
    });
    expect(json(join(home, "settings.json")).hooks.Stop[0].hooks[0].command).toBe(SECRET);
    expect(log.some((l) => /hidden/.test(l))).toBe(true);
  });

  it("keeps an MCP server's real address when editing it", async () => {
    const { handle, claudeJson, json } = await setup();
    const url = "https://mcp.x.com/mcp?token=abcdef0123456789abcdef";
    await handle({
      type: "setup:mcpAdd",
      req: "a",
      scope: "user",
      name: "web",
      transport: "http",
      url,
    });
    await handle({
      type: "setup:mcpAdd",
      req: "b",
      scope: "user",
      name: "web2",
      transport: "http",
      url: redactUrl(url),
      replace: "web",
    });
    expect(json(claudeJson).mcpServers.web2.url).toBe(url);
  });
});

describe("handleSetup: one hook at a time", () => {
  it("pauses a hook by taking it out of its file, and puts the same thing back", async () => {
    const { handle, json, home, paused, snapshot } = await setup();
    const file = join(home, "settings.json");
    const id = snapshot().hooks[0]!.id;
    await handle({ type: "setup:hookPause", id });
    expect(json(file).hooks).toBeUndefined();
    const [p] = await paused.list();
    expect(p).toMatchObject({ event: "Stop", handler: { type: "command", command: "done.sh" } });
    expect(snapshot().pausedHooks).toEqual([
      expect.objectContaining({ id: p!.id, command: "done.sh" }),
    ]);
    await handle({ type: "setup:hookResume", id: p!.id });
    expect(json(file).hooks).toEqual({
      Stop: [{ hooks: [{ type: "command", command: "done.sh" }] }],
    });
    expect(await paused.list()).toEqual([]);
    expect(json(file).theme).toBe("dark");
  });

  it("leaves a hook on when its pause can't be kept", async () => {
    const { handle, json, home, paused, snapshot, log } = await setup();
    paused.add = async () => {
      throw new Error("disk full");
    };
    await handle({ type: "setup:hookPause", id: snapshot().hooks[0]!.id });
    expect(json(join(home, "settings.json")).hooks).toEqual({
      Stop: [{ hooks: [{ type: "command", command: "done.sh" }] }],
    });
    expect(log.some((l) => /couldn't pause/.test(l))).toBe(true);
  });

  it("only resumes a paused hook this window shows", async () => {
    const { handle, paused, json, home } = await setup();
    const p = await paused.add({
      scope: "user",
      source: join(home, "..", "elsewhere", "settings.json"),
      event: "Stop",
      matcher: null,
      handler: { type: "command", command: "x.sh" },
    });
    await handle({ type: "setup:hookResume", id: p.id });
    expect(await paused.list()).toHaveLength(1);
    expect(json(join(home, "settings.json")).hooks.Stop[0].hooks).toHaveLength(1);
  });

  it("edits a hook's command and event in place", async () => {
    const { handle, json, home, snapshot, log } = await setup();
    await handle({
      type: "setup:hookEdit",
      req: "e1",
      id: snapshot().hooks[0]!.id,
      scope: "user",
      event: "PreToolUse",
      matcher: "Bash",
      command: "guard.sh",
      timeout: 10,
    });
    expect(log[0]).toMatch(/^confirm Change this hook to run "guard.sh" on PreToolUse/);
    expect(json(join(home, "settings.json")).hooks).toEqual({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "guard.sh", timeout: 10 }] },
      ],
    });
  });

  it("never loses a hook when the file it moves to can't be written", async () => {
    const { handle, json, home, ws, snapshot } = await setup();
    writeFileSync(join(ws, ".claude", "settings.json"), "{ not json");
    await handle({
      type: "setup:hookEdit",
      req: "e3",
      id: snapshot().hooks[0]!.id,
      scope: "project",
      event: "Stop",
      matcher: null,
      command: "done.sh",
      timeout: null,
    });
    expect(json(join(home, "settings.json")).hooks).toEqual({
      Stop: [{ hooks: [{ type: "command", command: "done.sh" }] }],
    });
  });

  it("moves a hook to the project's settings", async () => {
    const { handle, json, home, ws, snapshot } = await setup();
    await handle({
      type: "setup:hookEdit",
      req: "e2",
      id: snapshot().hooks[0]!.id,
      scope: "project",
      event: "Stop",
      matcher: null,
      command: "done.sh",
      timeout: null,
    });
    expect(json(join(home, "settings.json")).hooks).toBeUndefined();
    expect(json(join(ws, ".claude", "settings.json")).hooks).toEqual({
      Stop: [{ hooks: [{ type: "command", command: "done.sh" }] }],
    });
  });
});

describe("handleSetup: skills, agents and commands", () => {
  it("sends a known file's text to its detail page, and nothing for other files", async () => {
    const { handle, posted, home, root } = await setup({ content: true });
    const file = join(home, "skills", "notes", "SKILL.md");
    await handle({ type: "setup:read", file });
    await handle({ type: "setup:read", file: join(root, "secret.txt") });
    expect(posted).toEqual([
      {
        type: "setup:content",
        file,
        text: expect.stringContaining("Write it down."),
        truncated: false,
      },
    ]);
  });

  it("starts a chat with the skill or command typed in, never other text", async () => {
    const { handle, log, home } = await setup({ content: true });
    await handle({ type: "setup:launch", file: join(home, "skills", "notes", "SKILL.md") });
    await handle({ type: "setup:launch", file: join(home, "commands", "ship.md") });
    await handle({ type: "setup:launch", file: join(home, "settings.json") });
    expect(log).toEqual(["chat /notes ", "chat /ship "]);
  });

  it("starts a chat with a built-in command, only one from Claude's list", async () => {
    const { handle, log } = await setup();
    await handle({ type: "setup:launchBuiltin", name: "compact" });
    await handle({ type: "setup:launchBuiltin", name: "not-a-command" });
    expect(log).toEqual(["chat /compact "]);
  });

  it("deletes a skill by moving its whole folder to Orbit's trash, with Undo", async () => {
    const { handle, log, undos, home } = await setup({ content: true });
    const dir = join(home, "skills", "notes");
    await handle({ type: "setup:trash", file: join(dir, "SKILL.md") });
    expect(log[0]).toMatch(/^confirm Delete the skill notes\?/);
    expect(existsSync(dir)).toBe(false);
    expect(log).toContain("done Deleted skill notes");
    expect(await undos[0]!()).toBe(true);
    expect(readFileSync(join(dir, "scripts", "x.sh"), "utf8")).toBe("echo\n");
  });

  it("creates an agent from the form, in the chosen place", async () => {
    const { handle, home, log } = await setup({ content: true });
    await handle({
      type: "setup:agentSave",
      req: "r1",
      scope: "user",
      name: "reviewer",
      description: "Reviews code",
      model: "opus",
      tools: ["Read"],
      skills: [],
      prompt: "Review it.",
    });
    expect(log[0]).toMatch(/^confirm Create the agent reviewer/);
    expect(readFileSync(join(home, "agents", "reviewer.md"), "utf8")).toBe(
      "---\nname: reviewer\ndescription: Reviews code\nmodel: opus\ntools: Read\n---\nReview it.\n",
    );
  });

  it("edits an agent in place, keeping its other fields", async () => {
    const { handle, home } = await setup({ content: true });
    const file = join(home, "agents", "helper.md");
    expect(readFileSync(file, "utf8")).toContain("color: green");
    await handle({
      type: "setup:agentSave",
      req: "r2",
      file,
      name: "helper",
      description: "Helps more",
      model: null,
      tools: [],
      skills: ["notes"],
      prompt: "Help.",
    });
    expect(readFileSync(file, "utf8")).toBe(
      "---\nname: helper\ncolor: green\ndescription: Helps more\nskills:\n  - notes\n---\nHelp.\n",
    );
  });

  it("won't create over an agent that exists, or edit a file that isn't an agent", async () => {
    const { handle, home, log, replies } = await setup({ content: true });
    await handle({
      type: "setup:agentSave",
      req: "r3",
      scope: "user",
      name: "helper",
      description: "x",
      model: null,
      tools: [],
      skills: [],
      prompt: "",
    });
    await handle({
      type: "setup:agentSave",
      req: "r4",
      file: join(home, "settings.json"),
      name: "x",
      description: "x",
      model: null,
      tools: [],
      skills: [],
      prompt: "",
    });
    expect(log).toEqual([expect.stringMatching(/^warn There's already an agent named helper/)]);
    expect(replies).toEqual([
      ["r3", false],
      ["r4", false],
    ]);
  });

  it("duplicates an agent as name-copy next to it", async () => {
    const { handle, home } = await setup({ content: true });
    await handle({ type: "setup:agentDuplicate", file: join(home, "agents", "helper.md") });
    const copy = readFileSync(join(home, "agents", "helper-copy.md"), "utf8");
    expect(copy).toContain("name: helper-copy");
    expect(copy).toContain("color: green");
  });

  it("keeps it when the question is cancelled", async () => {
    const { handle, home } = await setup({ content: true, answer: "cancel" });
    await handle({ type: "setup:trash", file: join(home, "commands", "ship.md") });
    expect(existsSync(join(home, "commands", "ship.md"))).toBe(true);
  });
});

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

  it("sets git attribution to nothing or custom text, and voice dictation, from Config", async () => {
    const { handle, home, json, log } = await setup();
    await handle({
      type: "setup:setSetting",
      scope: "auto",
      key: "attribution.commit",
      value: "",
      quick: true,
    });
    await handle({
      type: "setup:setSetting",
      scope: "auto",
      key: "attribution.pr",
      value: "Made with Claude",
      quick: true,
    });
    await handle({
      type: "setup:setSetting",
      scope: "auto",
      key: "voice.enabled",
      value: true,
      quick: true,
    });
    await handle({ type: "setup:setSetting", scope: "auto", key: "voice.enabled", value: "loud" });
    const s = json(join(home, "settings.json"));
    expect(s.attribution).toEqual({ commit: "", pr: "Made with Claude" });
    expect(s.voice).toEqual({ enabled: true });
    expect(log.filter((l) => l.startsWith("warn") || l.startsWith("confirm"))).toEqual([
      expect.stringMatching(/^warn "loud" isn't a value/),
    ]);
  });

  it("resets the user settings file after asking, with a backup and Undo", async () => {
    const { handle, home, json, log } = await setup();
    await handle({ type: "setup:resetUserSettings" });
    expect(log[0]).toMatch(/^confirm Reset your user settings to Claude's defaults\?.* ⚠ /);
    expect(json(join(home, "settings.json"))).toEqual({});
  });

  it("applies Config's quick settings without a question, still backed up and undoable", async () => {
    const { handle, home, json, log } = await setup();
    await handle({
      type: "setup:setSetting",
      scope: "auto",
      key: "effortLevel",
      value: "high",
      quick: true,
    });
    expect(json(join(home, "settings.json")).effortLevel).toBe("high");
    expect(log.some((l) => l.startsWith("confirm"))).toBe(false);
  });

  it("only skips the question for Config's own settings, written where they take effect", async () => {
    const { handle, log } = await setup();
    await handle({
      type: "setup:setSetting",
      scope: "user",
      key: "theme",
      value: "light",
      quick: true,
    });
    await handle({
      type: "setup:setSetting",
      scope: "auto",
      key: "outputStyle",
      value: "x",
      quick: true,
    });
    await handle({
      type: "setup:setSetting",
      scope: "project",
      key: "effortLevel",
      value: "low",
      quick: true,
    });
    expect(log.filter((l) => l.startsWith("confirm"))).toHaveLength(2);
    expect(log.filter((l) => l.startsWith("confirm"))[0]).toMatch(/Theme/);
    expect(log.filter((l) => l.startsWith("confirm"))[1]).toMatch(/Effort/);
  });

  it("asks before Claude deletes old chats sooner, even from Config", async () => {
    const { handle, log } = await setup();
    await handle({
      type: "setup:setSetting",
      scope: "auto",
      key: "cleanupPeriodDays",
      value: 3,
      quick: true,
    });
    expect(log[0]).toMatch(/^confirm .*⚠.*delete/s);
  });

  it("still asks first when a quick change turns off a safety check", async () => {
    const { handle, log } = await setup();
    await handle({
      type: "setup:setSetting",
      scope: "user",
      key: "permissions.defaultMode",
      value: "bypassPermissions",
      quick: true,
    });
    expect(log[0]).toMatch(/^confirm .*⚠/);
  });

  it("writes the nested settings Config offers, and only their real values", async () => {
    const { handle, home, json, log } = await setup();
    await handle({
      type: "setup:setSetting",
      scope: "user",
      key: "sandbox.enabled",
      value: true,
      quick: true,
    });
    await handle({
      type: "setup:setSetting",
      scope: "user",
      key: "permissions.disableBypassPermissionsMode",
      value: "disable",
      quick: true,
    });
    const s = json(join(home, "settings.json"));
    expect(s.sandbox).toEqual({ enabled: true });
    expect(s.permissions.disableBypassPermissionsMode).toBe("disable");
    await handle({ type: "setup:setSetting", scope: "user", key: "sandbox.enabled", value: "yes" });
    await handle({ type: "setup:setSetting", scope: "user", key: "sandbox.network", value: true });
    expect(log.filter((l) => l.startsWith("warn"))).toHaveLength(2);
  });

  it("says so when resetting leaves another file's value in charge", async () => {
    const { handle, ws, log } = await setup();
    writeFileSync(join(ws, ".claude", "settings.json"), JSON.stringify({ verbose: true }));
    await handle({
      type: "setup:setSetting",
      scope: "auto",
      key: "verbose",
      value: null,
      quick: true,
    });
    expect(log.some((l) => /^warn .*also set in another settings file/.test(l))).toBe(true);
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

  it("runs only Claude's fixed MCP and slash commands, with a server name where needed", async () => {
    const { handle, log } = await setup();
    await handle({ type: "setup:run", what: "mcpList" });
    await handle({ type: "setup:run", what: "mcpGet", name: "gh" });
    await handle({ type: "setup:run", what: "mcpLogout" });
    await handle({ type: "setup:run", what: "slashHooks" });
    expect(log).toContain("claude mcp list");
    expect(log).toContain("claude mcp get gh");
    expect(log).toContain("claude /hooks");
    expect(log.some((l: string) => l.includes("logout"))).toBe(false);
  });

  it("edits a user server, keeping its saved secrets and adding new ones", async () => {
    const { handle, claudeJson, json } = await setup();
    await handle({
      type: "setup:mcpAdd",
      scope: "user",
      name: "gh",
      transport: "http",
      url: "https://a/mcp",
      headers: { Authorization: "Bearer one" },
    });
    await handle({
      type: "setup:mcpAdd",
      scope: "user",
      name: "github",
      transport: "http",
      url: "https://b/mcp",
      env: { REGION: "eu" },
      replace: "gh",
    });
    const servers = json(claudeJson).mcpServers;
    expect(servers.gh).toBeUndefined();
    expect(servers.github).toEqual({
      type: "http",
      url: "https://b/mcp",
      env: { REGION: "eu" },
      headers: { Authorization: "Bearer one" },
    });
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

  it("adds a folder Claude may use, from the folder picker, and removes it", async () => {
    const { handle, home, json, root, deps } = await setup();
    const extra = join(root, "shared-lib");
    deps.pickFolder = async () => extra;
    await handle({ type: "setup:dir", op: "add", scope: "user" });
    expect(json(join(home, "settings.json")).permissions.additionalDirectories).toEqual([extra]);
    await handle({ type: "setup:dir", op: "add", scope: "user" });
    expect(json(join(home, "settings.json")).permissions.additionalDirectories).toEqual([extra]);
    await handle({ type: "setup:dir", op: "remove", scope: "user", dir: extra });
    expect(json(join(home, "settings.json")).permissions?.additionalDirectories ?? []).toEqual([]);
  });

  it("does nothing when the folder picker is closed", async () => {
    const { handle, home, json, deps } = await setup();
    deps.pickFolder = async () => null;
    await handle({ type: "setup:dir", op: "add", scope: "user" });
    expect(json(join(home, "settings.json")).permissions).toBeUndefined();
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

describe("handleSetup: forms", () => {
  it("tells the form whether its change was made", async () => {
    const { handle, deps, replies } = await setup();
    const msg = {
      type: "setup:mcpAdd",
      scope: "user",
      name: "gh",
      transport: "http",
      url: "https://x/mcp",
    };
    await handle({ ...msg, req: "r1" });
    await handle({ ...msg, req: "r2" }); // same name again: refused
    deps.confirm.confirm = async () => "cancel";
    await handle({ ...msg, name: "gh2", req: "r3" });
    expect(replies).toEqual([
      ["r1", true],
      ["r2", false],
      ["r3", false],
    ]);
  });

  it("says so instead of silently dropping input it can't use", async () => {
    const { handle, log, replies } = await setup();
    const handled = await handle({
      type: "setup:mcpAdd",
      scope: "user",
      name: "my server",
      transport: "http",
      url: "https://x",
      req: "r9",
    });
    expect(handled).toBe(true);
    expect(log[0]).toMatch(/^warn .*check/i);
    expect(replies).toEqual([["r9", false]]);
  });

  it("starts npx through cmd /c on Windows for servers only you use", async () => {
    const { handle, claudeJson, json } = await setup({ platform: "win32" });
    await handle({
      type: "setup:mcpAdd",
      scope: "user",
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "srv"],
    });
    expect(json(claudeJson).mcpServers.fs).toEqual({
      type: "stdio",
      command: "cmd",
      args: ["/c", "npx", "-y", "srv"],
    });
  });

  it("keeps the shared .mcp.json portable and explains why", async () => {
    const { handle, ws, json, log } = await setup({ platform: "win32" });
    await handle({
      type: "setup:mcpAdd",
      scope: "project",
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "srv"],
    });
    expect(json(join(ws, ".mcp.json")).mcpServers.fs.command).toBe("npx");
    expect(log[0]).toMatch(/cmd \/c/);
  });
});

describe("handleSetup: remove says where", () => {
  it.each([
    ["local", /this folder \(just you\)/],
    ["user", /all your projects/],
    ["project", /shared .*everyone/],
  ])("names the %s scope in the question", async (scope, where) => {
    const { handle, log, ws, claudeJson, json } = await setup();
    const cj = json(claudeJson);
    writeFileSync(claudeJson, JSON.stringify({ ...cj, mcpServers: { db: { command: "db" } } }));
    writeFileSync(join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db" } } }));
    await handle({ type: "setup:mcpRemove", scope, name: "db" });
    expect(log[0]).toMatch(where);
  });
});

describe("handleSetup: masked values", () => {
  const rule = 'Bash(curl -H "Authorization: Bearer rule-TOKEN-10" https://api.x)';

  it("removes a permission rule the view only saw masked", async () => {
    const { handle, home, json, log } = await setup({
      settings: { permissions: { allow: [rule, "Read"] } },
    });
    await handle({
      type: "setup:rule",
      op: "remove",
      scope: "user",
      list: "allow",
      rule: redactText(rule),
    });
    expect(json(join(home, "settings.json")).permissions.allow).toEqual(["Read"]);
    expect(log[0]).not.toContain("rule-TOKEN-10");
  });

  it("never shows a hook's token in the confirm", async () => {
    const { handle, deps, log } = await setup({
      settings: {
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "curl -H 'Authorization: Bearer hook-TOKEN-4' x" },
              ],
            },
          ],
        },
      },
    });
    await handle({ type: "setup:hookRemove", id: deps.snapshot()!.hooks[0]!.id });
    expect(log[0]).toMatch(/^confirm Remove this Stop hook/);
    expect(log[0]).not.toContain("hook-TOKEN-4");
  });
});

describe("handleSetup: number settings follow Claude's own limits", () => {
  it.each([
    ["cleanupPeriodDays", 2.5, /whole number/],
    ["cleanupPeriodDays", 0, /at least 1/],
    ["feedbackSurveyRate", 1.5, /at most 1/],
    ["skillListingBudgetFraction", 0, /more than 0/],
    ["skillListingMaxDescChars", 0, /more than 0/],
  ])("refuses %s = %s", async (key, value, why) => {
    const { handle, home, json, log } = await setup({ settings: {} });
    await handle({ type: "setup:setSetting", scope: "user", key, value });
    expect(log[0]).toMatch(why);
    expect(json(join(home, "settings.json"))[key]).toBeUndefined();
  });

  it("accepts values inside the limits", async () => {
    const { handle, home, json } = await setup({ settings: {} });
    await handle({
      type: "setup:setSetting",
      scope: "user",
      key: "feedbackSurveyRate",
      value: 0.5,
    });
    await handle({ type: "setup:setSetting", scope: "user", key: "cleanupPeriodDays", value: 30 });
    expect(json(join(home, "settings.json"))).toMatchObject({
      feedbackSurveyRate: 0.5,
      cleanupPeriodDays: 30,
    });
  });
});

describe("handleSetup: risky choices", () => {
  it("names the mode plainly and warns before bypassing every check", async () => {
    const { handle, log } = await setup({ settings: {} });
    await handle({
      type: "setup:setSetting",
      scope: "user",
      key: "permissions.defaultMode",
      value: "bypassPermissions",
    });
    expect(log[0]).toMatch(/"Bypass all checks \(sandboxes only\)".* ⚠ .*without asking/);
  });

  it("warns before auto-approving every project's MCP servers", async () => {
    const { handle, log } = await setup({ settings: {} });
    await handle({
      type: "setup:setSetting",
      scope: "user",
      key: "enableAllProjectMcpServers",
      value: true,
    });
    expect(log[0]).toMatch(/ ⚠ .*clone/);
  });

  it("asks plainly for safe choices", async () => {
    const { handle, log } = await setup({ settings: {} });
    await handle({ type: "setup:setSetting", scope: "user", key: "theme", value: "light" });
    expect(log[0]).not.toMatch(/⚠/);
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
