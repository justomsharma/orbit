import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { readHooks, readPluginHooks } from "../hooks";
import type { InstalledPlugin } from "../plugins";
import { put, settingsOf } from "./configFixture";

const tmp = useTmpDir();

const USER = join("/home", "me", ".claude", "settings.json");

describe("readHooks", () => {
  it("lists every handler with its event, matcher and position", () => {
    const hooks = readHooks(
      [
        settingsOf(
          "user",
          {
            env: { API_KEY: "sk-secret-123" },
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    { type: "command", command: "node ~/.claude/check-bash.js", timeout: 30 },
                  ],
                },
                {
                  matcher: "Edit|Write",
                  hooks: [
                    { type: "command", command: "npx prettier --write" },
                    { type: "mcp_tool", server: "lint", tool: "check" },
                  ],
                },
              ],
              PostToolUse: [
                {
                  hooks: [
                    {
                      type: "http",
                      url: "http://localhost:4000/hook",
                      headers: { Authorization: "Bearer tok-999" },
                    },
                  ],
                },
              ],
              Stop: [{ hooks: [{ type: "prompt", prompt: "Did the tests pass?" }] }],
              SubagentStop: [{ matcher: "", hooks: [{ type: "agent", prompt: "Review it" }] }],
            },
          },
          USER,
        ),
      ],
      [],
    );
    expect(hooks).toEqual([
      {
        id: `user:${USER}:PreToolUse:0:0`,
        scope: "user",
        source: USER,
        plugin: null,
        event: "PreToolUse",
        matcher: "Bash",
        group: 0,
        index: 0,
        type: "command",
        command: "node ~/.claude/check-bash.js",
        url: null,
        timeout: 30,
      },
      expect.objectContaining({
        id: `user:${USER}:PreToolUse:1:0`,
        matcher: "Edit|Write",
        group: 1,
        index: 0,
        command: "npx prettier --write",
        timeout: null,
      }),
      expect.objectContaining({
        id: `user:${USER}:PreToolUse:1:1`,
        type: "mcp_tool",
        command: null,
      }),
      expect.objectContaining({
        event: "PostToolUse",
        matcher: null,
        type: "http",
        url: "http://localhost:4000/hook",
        command: null,
      }),
      expect.objectContaining({ event: "Stop", matcher: null, type: "prompt" }),
      expect.objectContaining({ event: "SubagentStop", matcher: "", type: "agent" }),
    ]);
    expect(JSON.stringify(hooks)).not.toContain("tok-999");
    expect(JSON.stringify(hooks)).not.toContain("sk-secret-123");
  });

  it("reads hooks from every settings scope", () => {
    const group = { hooks: [{ type: "command", command: "echo hi" }] };
    const hooks = readHooks(
      ["user", "project", "local", "managed"].map((s) =>
        settingsOf(s as "user", { hooks: { Stop: [group] } }),
      ),
      [],
    );
    expect(hooks.map((h) => h.scope)).toEqual(["user", "project", "local", "managed"]);
    expect(new Set(hooks.map((h) => h.id)).size).toBe(4);
  });

  it("skips malformed groups and handlers but keeps real positions", () => {
    const hooks = readHooks(
      [
        settingsOf(
          "project",
          {
            hooks: {
              PreToolUse: [
                "not a group",
                { matcher: "Bash", hooks: "echo" },
                { matcher: 7, hooks: [null, { command: "no type" }, { type: "command" }] },
              ],
              Stop: { hooks: [{ type: "command", command: "x" }] },
              Notification: null,
            },
          },
          "p.json",
        ),
        settingsOf("user", { hooks: ["nope"] }),
        settingsOf("local", { hooks: "nope" }),
        settingsOf("managed", null),
      ],
      [],
    );
    expect(hooks).toEqual([
      expect.objectContaining({
        id: "project:p.json:PreToolUse:2:2",
        matcher: null,
        group: 2,
        index: 2,
        type: "command",
        command: null,
      }),
    ]);
  });

  it("reads plugin hooks in both file shapes", () => {
    const hooks = readHooks(
      [],
      [
        {
          plugin: "fmt@official",
          source: "a/hooks.json",
          data: {
            description: "Formatting",
            hooks: {
              PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "f" }] }],
            },
          },
        },
        {
          plugin: "guard@official",
          source: "b/hooks.json",
          data: { PreToolUse: [{ hooks: [{ type: "command", command: "g" }] }] },
        },
        { plugin: "junk@official", source: "c/hooks.json", data: "junk" },
      ],
    );
    expect(hooks).toEqual([
      expect.objectContaining({
        id: "plugin:a/hooks.json:PostToolUse:0:0",
        scope: "plugin",
        plugin: "fmt@official",
        source: "a/hooks.json",
        matcher: "Write",
      }),
      expect.objectContaining({
        scope: "plugin",
        plugin: "guard@official",
        event: "PreToolUse",
        command: "g",
      }),
    ]);
  });
});

function plugin(id: string, installPath: string, enabled: boolean): InstalledPlugin {
  const at = id.lastIndexOf("@");
  return {
    id,
    name: id.slice(0, at),
    marketplace: id.slice(at + 1),
    scope: "user",
    projectPath: null,
    installPath,
    version: "1.0.0",
    description: null,
    enabled,
    enabledIn: enabled ? ["user"] : [],
    counts: { skills: 0, agents: 0, commands: 0, hooks: 0, mcpServers: 0 },
    problem: null,
  };
}

describe("readPluginHooks", () => {
  it("reads hooks/hooks.json of enabled plugins only", async () => {
    const d = tmp();
    const on = join(d, "on");
    const off = join(d, "off");
    const bad = join(d, "bad");
    const data = { hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } };
    put(join(on, "hooks", "hooks.json"), data);
    put(join(off, "hooks", "hooks.json"), data);
    put(join(bad, "hooks", "hooks.json"), "{ // nope");
    const out = await readPluginHooks([
      plugin("on@m", on, true),
      plugin("off@m", off, false),
      plugin("bad@m", bad, true),
      plugin("none@m", join(d, "none"), true),
      plugin("ghost@m", "", true),
    ]);
    expect(out).toEqual([{ plugin: "on@m", source: join(on, "hooks", "hooks.json"), data }]);
  });
});
