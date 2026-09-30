import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { SetupService } from "../setupService";

const tmp = useTmpDir();

function fixture() {
  const root = tmp();
  const home = join(root, ".claude");
  const ws = join(root, "shop");
  mkdirSync(join(home, "skills", "deploy"), { recursive: true });
  mkdirSync(join(ws, ".claude"), { recursive: true });
  writeFileSync(
    join(home, "settings.json"),
    JSON.stringify({
      model: "opus",
      theme: "dark",
      thme: "x",
      env: { ANTHROPIC_API_KEY: "sk-ant-SECRET-1" },
      apiKeyHelper: "/secret/helper.sh",
      permissions: { allow: ["Read"], defaultMode: "plan" },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "./missing.sh" }] }] },
    }),
  );
  writeFileSync(
    join(home, "skills", "deploy", "SKILL.md"),
    "---\nname: deploy\ndescription: Ship it\n---\nSteps",
  );
  writeFileSync(
    join(root, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        gh: { type: "http", url: "https://x", headers: { Authorization: "Bearer SECRET-2" } },
        nope: { command: "definitely-not-a-real-command-xyz" },
      },
    }),
  );
  writeFileSync(
    join(ws, ".mcp.json"),
    JSON.stringify({ mcpServers: { db: { command: "node", env: { PW: "SECRET-3" } } } }),
  );
  return { root, home, ws };
}

const svc = (home: string, root: string) =>
  new SetupService({
    home,
    claudeJson: join(root, ".claude.json"),
    userHome: root,
    platform: process.platform,
    commandExists: async (c) => c === "node",
  });

describe("SetupService", () => {
  it("gathers the whole setup for the open folder", async () => {
    const { root, home, ws } = fixture();
    const s = await svc(home, root).snapshot(ws);
    expect(s.mcp.map((m) => `${m.scope}:${m.name}`).sort()).toEqual([
      "project:db",
      "user:gh",
      "user:nope",
    ]);
    expect(s.skills.map((k) => k.name)).toEqual(["deploy"]);
    expect(s.permissions.rules).toEqual([{ scope: "user", list: "allow", rule: "Read" }]);
    expect(s.hooks).toHaveLength(1);
  });

  it("finds real problems: typo, missing MCP command, missing hook script, pending project server", async () => {
    const { root, home, ws } = fixture();
    const s = await svc(home, root).snapshot(ws);
    const titles = s.issues.map((i) => i.title);
    expect(titles).toContain('MCP server "nope" can\'t start');
    expect(titles).toContain("A Stop hook runs a script that doesn't exist");
    expect(titles).toContain('Unknown setting "thme" in your user settings');
    expect(titles).toContain('Project MCP server "db" is waiting for approval');
  });

  it("never sends secret values to the view", async () => {
    const { root, home, ws } = fixture();
    const json = JSON.stringify(await svc(home, root).snapshot(ws));
    for (const secret of ["sk-ant-SECRET-1", "SECRET-2", "SECRET-3", "/secret/helper.sh"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("sends plain setting values for the editor, and only names for env", async () => {
    const { root, home, ws } = fixture();
    const s = await svc(home, root).snapshot(ws);
    const user = s.settings.find((f) => f.scope === "user")!;
    expect(user.values.theme).toEqual({ value: "dark" });
    expect(user.values.env).toEqual({ keys: ["ANTHROPIC_API_KEY"] });
    expect(user.values.permissions).toEqual({ keys: ["allow", "defaultMode"] });
    expect(user.values.apiKeyHelper).toEqual({ hidden: true });
  });

  it("shows skill visibility choices in full (they are not secrets)", async () => {
    const { viewValue } = await import("../setupService");
    expect(viewValue("skillOverrides", { deploy: "off", x: { nested: 1 } })).toEqual({
      entries: { deploy: "off" },
    });
  });

  it("works with no folder open and with no Claude data at all", async () => {
    const root = tmp();
    const s = await svc(join(root, ".claude"), root).snapshot(null);
    expect(s.workspace).toBeNull();
    expect(s.mcp).toEqual([]);
    expect(Array.isArray(s.issues)).toBe(true);
  });
});
