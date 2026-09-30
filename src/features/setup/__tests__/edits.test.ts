import { describe, expect, it } from "vitest";
import {
  addHook,
  addMcpServer,
  addPermissionRule,
  EditError,
  removeHook,
  removeMcpServer,
  removePermissionRule,
  setMcpApproval,
  setPluginEnabled,
  setSetting,
  setSkillVisibility,
} from "../edits";

type Obj = Record<string, unknown>;
const run = (mutate: (o: Obj) => void, start: Obj) => {
  const o = structuredClone(start);
  mutate(o);
  return o;
};

describe("setSetting", () => {
  it("sets, replaces and removes a top-level key", () => {
    expect(run(setSetting("theme", "dark"), { model: "opus" })).toEqual({
      model: "opus",
      theme: "dark",
    });
    expect(run(setSetting("theme", undefined), { theme: "dark", a: 1 })).toEqual({ a: 1 });
  });

  it("sets a nested permissions key without touching siblings", () => {
    expect(
      run(setSetting("permissions.defaultMode", "plan"), { permissions: { allow: ["Read"] } }),
    ).toEqual({ permissions: { allow: ["Read"], defaultMode: "plan" } });
  });

  it("refuses to overwrite a non-object where an object is needed", () => {
    expect(() =>
      run(setSetting("permissions.defaultMode", "plan"), { permissions: "weird" }),
    ).toThrow(EditError);
  });
});

describe("setPluginEnabled", () => {
  it("records true/false under enabledPlugins", () => {
    expect(
      run(setPluginEnabled("a@m", false), { enabledPlugins: { "a@m": true, "b@m": true } }),
    ).toEqual({
      enabledPlugins: { "a@m": false, "b@m": true },
    });
    expect(run(setPluginEnabled("c@m", true), {})).toEqual({ enabledPlugins: { "c@m": true } });
  });
});

describe("setMcpApproval", () => {
  it("approves a project server and clears any rejection", () => {
    expect(run(setMcpApproval("db", "approved"), { disabledMcpjsonServers: ["db", "x"] })).toEqual({
      disabledMcpjsonServers: ["x"],
      enabledMcpjsonServers: ["db"],
    });
  });

  it("rejects without duplicating", () => {
    expect(
      run(setMcpApproval("db", "rejected"), {
        enabledMcpjsonServers: ["db"],
        disabledMcpjsonServers: ["db"],
      }),
    ).toEqual({ enabledMcpjsonServers: [], disabledMcpjsonServers: ["db"] });
  });
});

describe("MCP servers in ~/.claude.json and .mcp.json", () => {
  const ws = "C:\\code\\shop";

  it("adds and removes a user server", () => {
    const added = run(
      addMcpServer({ scope: "user", name: "gh", server: { type: "http", url: "https://x" } }),
      {
        numStartups: 3,
      },
    );
    expect(added).toEqual({
      numStartups: 3,
      mcpServers: { gh: { type: "http", url: "https://x" } },
    });
    expect(run(removeMcpServer({ scope: "user", name: "gh" }), added)).toEqual({
      numStartups: 3,
      mcpServers: {},
    });
  });

  it("finds the project entry for a local server whatever the path case or slashes", () => {
    const start = {
      projects: { "c:/Code/Shop": { mcpServers: { db: { command: "x" } }, lastCost: 1 } },
    };
    const out = run(
      removeMcpServer({ scope: "local", name: "db", workspace: ws, platform: "win32" }),
      start,
    );
    expect(out).toEqual({ projects: { "c:/Code/Shop": { mcpServers: {}, lastCost: 1 } } });
  });

  it("creates the project entry when adding the first local server", () => {
    const out = run(
      addMcpServer({
        scope: "local",
        name: "db",
        server: { command: "x" },
        workspace: ws,
        platform: "win32",
      }),
      { projects: {} },
    );
    expect(out).toEqual({ projects: { [ws]: { mcpServers: { db: { command: "x" } } } } });
  });

  it("refuses to add a name that already exists in that scope", () => {
    expect(() =>
      run(addMcpServer({ scope: "user", name: "gh", server: { command: "x" } }), {
        mcpServers: { gh: {} },
      }),
    ).toThrow(/already exists/);
  });

  it("refuses to remove a server that is no longer there", () => {
    expect(() =>
      run(removeMcpServer({ scope: "project", name: "db" }), { mcpServers: {} }),
    ).toThrow(/no longer/);
  });

  it("rejects server names that are not simple identifiers", () => {
    expect(() =>
      run(addMcpServer({ scope: "user", name: "a b;rm", server: { command: "x" } }), {}),
    ).toThrow(EditError);
  });
});

describe("hooks", () => {
  const base = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: "a.sh" },
            { type: "command", command: "b.sh" },
          ],
        },
      ],
      Stop: [{ hooks: [{ type: "command", command: "done.sh" }] }],
    },
  };

  it("removes one handler and keeps the rest", () => {
    const out = run(removeHook({ event: "PreToolUse", group: 0, index: 1, command: "b.sh" }), base);
    expect(out).toEqual({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "a.sh" }] }],
        Stop: base.hooks.Stop,
      },
    });
  });

  it("cleans up empty groups and events", () => {
    const out = run(removeHook({ event: "Stop", group: 0, index: 0, command: "done.sh" }), base);
    expect(out.hooks).toEqual({ PreToolUse: base.hooks.PreToolUse });
  });

  it("refuses when the hook changed since it was shown", () => {
    expect(() =>
      run(removeHook({ event: "PreToolUse", group: 0, index: 1, command: "x.sh" }), base),
    ).toThrow(/changed/);
  });

  it("adds a hook to a matching group or a new one", () => {
    const out = run(
      addHook({ event: "PreToolUse", matcher: "Bash", command: "c.sh", timeout: 30 }),
      base,
    );
    expect((out.hooks as Obj).PreToolUse).toEqual([
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: "a.sh" },
          { type: "command", command: "b.sh" },
          { type: "command", command: "c.sh", timeout: 30 },
        ],
      },
    ]);
    const fresh = run(addHook({ event: "SessionStart", matcher: null, command: "hi.sh" }), {});
    expect(fresh).toEqual({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "hi.sh" }] }] },
    });
  });
});

describe("permission rules", () => {
  it("adds without duplicates and removes exactly one rule", () => {
    const a = run(addPermissionRule("allow", "Bash(npm test)"), {
      permissions: { allow: ["Read"] },
    });
    expect(a).toEqual({ permissions: { allow: ["Read", "Bash(npm test)"] } });
    expect(run(addPermissionRule("allow", "Read"), a)).toEqual(a);
    expect(run(removePermissionRule("allow", "Read"), a)).toEqual({
      permissions: { allow: ["Bash(npm test)"] },
    });
  });

  it("refuses an empty rule", () => {
    expect(() => run(addPermissionRule("deny", "  "), {})).toThrow(EditError);
  });
});

describe("setSkillVisibility", () => {
  it("writes skillOverrides and removes the entry when back to the default", () => {
    const off = run(setSkillVisibility("deploy", "off"), {});
    expect(off).toEqual({ skillOverrides: { deploy: "off" } });
    expect(run(setSkillVisibility("deploy", "on"), off)).toEqual({ skillOverrides: {} });
  });
});
