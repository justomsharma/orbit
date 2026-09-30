import { mkdirSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { redactText } from "../../features/setup/redact";
import { SetupService, viewSnapshot } from "../setupService";

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

  it("hides tokens in server args and URLs and in hook commands before they reach the view", async () => {
    const { root, home, ws } = fixture();
    writeFileSync(
      join(home, "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ['Bash(curl -H "Authorization: Bearer rule-TOKEN-10" https://api.x)'],
          deny: ['Bash(curl -H "Authorization: Bearer rule-TOKEN-10" https://api.x)'],
        },
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: 'curl -H "Authorization: Bearer hook-TOKEN-4" ./gone.sh',
                },
                { type: "http", url: "https://hooks.example.com/h?token=hook-TOKEN-5" },
              ],
            },
          ],
        },
      }),
    );
    writeFileSync(
      join(root, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          search: {
            command: "npx",
            args: ["-y", "search-mcp", "--api-key", "arg-SECRET-6", "--token=arg-SECRET-7"],
          },
          db: { command: "pg-mcp", args: ["postgres://ana:pg-PASS-8@db.local/shop"] },
          remote: { type: "http", url: "https://mcp.example.com/sse?api_key=url-KEY-9" },
          zap: { type: "sse", url: "https://actions.zapier.com/mcp/sk-ak-a1B2c3D4e5F6g7H8/sse" },
        },
      }),
    );
    const snap = await svc(home, root).snapshot(ws);
    const json = JSON.stringify(viewSnapshot(snap));
    for (const secret of [
      "hook-TOKEN-4",
      "hook-TOKEN-5",
      "arg-SECRET-6",
      "arg-SECRET-7",
      "pg-PASS-8",
      "url-KEY-9",
      "sk-ak-a1B2c3D4e5F6g7H8",
      "rule-TOKEN-10",
    ]) {
      expect(json).not.toContain(secret);
    }
    const view = viewSnapshot(snap);
    expect(view.mcp.find((m) => m.name === "search")!.args).toEqual([
      "-y",
      "search-mcp",
      "--api-key",
      "•••",
      "--token=•••",
    ]);
    expect(view.hooks[0]!.command).toBe('curl -H "Authorization: Bearer •••" ./gone.sh');
    // The host keeps the real values: removing a hook compares the file against them.
    expect(snap.hooks[0]!.command).toContain("hook-TOKEN-4");
    expect(view.hooks[0]!.id).toBe(snap.hooks[0]!.id);
    expect(view.issues.map((i) => i.id)).toEqual(snap.issues.map((i) => redactText(i.id)));
  });

  it("skips a ~/.claude.json over 32 MB honestly and keeps everything else", async () => {
    const { root, home, ws } = fixture();
    // Sparse: the size is what matters, the content is never read.
    truncateSync(join(root, ".claude.json"), 33 * 1024 * 1024);
    const s = await svc(home, root).snapshot(ws);
    expect(s.mcp.map((m) => `${m.scope}:${m.name}`)).toEqual(["project:db"]);
    const i = s.issues.find((x) => x.area === "mcp" && x.file === join(root, ".claude.json"));
    expect(i).toMatchObject({ severity: "info", title: "Orbit skipped ~/.claude.json" });
    expect(i!.claudePrompt).toBeNull();
    expect(s.issues.some((x) => x.severity === "error" && /claude\.json/.test(x.title))).toBe(
      false,
    );
    expect(s.hooks).toHaveLength(1);
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
