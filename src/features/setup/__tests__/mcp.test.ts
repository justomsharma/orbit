import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { obj } from "../../../core/jsonl";
import { readClaudeJson, readMcpServers } from "../mcp";
import type { InstalledPlugin } from "../plugins";
import type { SettingsFile } from "../settings";
import { put, settingsOf } from "./configFixture";

const tmp = useTmpDir();

const SECRETS = ["sk-secret-123", "Bearer tok-999", "tok-999", "pg-pass-777"];

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

interface Setup {
  claude?: unknown;
  mcpJson?: unknown;
  settings?: SettingsFile[];
  plugins?: InstalledPlugin[];
  workspace?: string | null;
  platform?: NodeJS.Platform;
}

async function read(s: Setup) {
  const home = tmp();
  const ws = s.workspace === undefined ? tmp() : s.workspace;
  const claudeJson = join(tmp(), ".claude.json");
  if (s.claude !== undefined) put(claudeJson, s.claude);
  if (s.mcpJson !== undefined && ws) put(join(ws, ".mcp.json"), s.mcpJson);
  const servers = await readMcpServers({
    home,
    claudeJson,
    workspace: ws,
    settings: s.settings ?? [],
    plugins: s.plugins ?? [],
    platform: s.platform,
  });
  return { servers, ws, claudeJson };
}

describe("readMcpServers", () => {
  it("returns [] when nothing is configured", async () => {
    expect((await read({})).servers).toEqual([]);
  });

  it("reads user, local and project servers without secret values", async () => {
    const ws = tmp();
    const { servers, claudeJson } = await read({
      workspace: ws,
      claude: {
        numStartups: 12,
        mcpServers: {
          github: {
            type: "http",
            url: "https://api.githubcopilot.com/mcp/",
            headers: { Authorization: "Bearer tok-999", "X-Team": "core" },
          },
        },
        projects: {
          [ws]: {
            allowedTools: [],
            mcpServers: {
              postgres: {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-postgres", 5432, null],
                env: { PGPASSWORD: "pg-pass-777", API_KEY: "sk-secret-123" },
              },
            },
          },
        },
      },
      mcpJson: {
        mcpServers: {
          docs: { type: "sse", url: "https://docs.x.dev/sse" },
          browser: { type: "stdio", command: "node", args: ["browser.js"] },
        },
      },
    });
    expect(servers).toEqual([
      {
        name: "github",
        scope: "user",
        source: claudeJson,
        plugin: null,
        transport: "http",
        command: null,
        args: [],
        url: "https://api.githubcopilot.com/mcp/",
        envKeys: [],
        headerKeys: ["Authorization", "X-Team"],
        approval: null,
        problem: null,
      },
      {
        name: "postgres",
        scope: "local",
        source: claudeJson,
        plugin: null,
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        url: null,
        envKeys: ["API_KEY", "PGPASSWORD"],
        headerKeys: [],
        approval: null,
        problem: null,
      },
      expect.objectContaining({
        name: "docs",
        scope: "project",
        source: join(ws, ".mcp.json"),
        transport: "sse",
        url: "https://docs.x.dev/sse",
        approval: "pending",
      }),
      expect.objectContaining({ name: "browser", scope: "project", transport: "stdio" }),
    ]);
    const text = JSON.stringify(servers);
    for (const s of SECRETS) expect(text).not.toContain(s);
  });

  it("infers the transport and reports what is missing", async () => {
    const { servers } = await read({
      claude: {
        mcpServers: {
          a: { command: "uvx", args: ["mcp-a"] },
          b: { url: "https://b.dev/mcp" },
          c: { type: "ws", url: "wss://c.dev" },
          d: {},
          e: { type: "carrier-pigeon", url: "x" },
          f: { type: "stdio" },
          g: { type: "http" },
          h: "npx h",
          i: { command: 5, url: ["x"], env: "API_KEY=sk-secret-123", headers: ["Bearer tok-999"] },
        },
      },
    });
    const brief = servers.map((s) => [s.name, s.transport, s.problem]);
    expect(brief).toEqual([
      ["a", "stdio", null],
      ["b", "http", null],
      ["c", "ws", null],
      ["d", "unknown", "No command or URL set"],
      ["e", "unknown", 'Unknown type "carrier-pigeon"'],
      ["f", "stdio", "No command set"],
      ["g", "http", "No URL set"],
      ["h", "unknown", "Not a server definition (expected an object)"],
      ["i", "unknown", "No command or URL set"],
    ]);
    const text = JSON.stringify(servers);
    for (const s of SECRETS) expect(text).not.toContain(s);
  });

  it("skips folder scopes when no folder is open", async () => {
    const { servers } = await read({
      workspace: null,
      claude: {
        mcpServers: { a: { command: "a" } },
        projects: { "/x": { mcpServers: { b: { command: "b" } } } },
      },
    });
    expect(servers.map((s) => s.name)).toEqual(["a"]);
  });

  it.each([
    ["forward slashes, other case", "c:/Code/App"],
    ["backslashes, other case", "C:\\code\\APP"],
    ["trailing slash", "C:\\Code\\App\\"],
  ])("matches the Windows project key with %s", async (_, key) => {
    const { servers } = await read({
      workspace: "C:\\Code\\App",
      platform: "win32",
      claude: { projects: { [key]: { mcpServers: { local1: { command: "x" } } } } },
    });
    expect(servers.map((s) => [s.name, s.scope])).toEqual([["local1", "local"]]);
  });

  it("prefers the exact project key when several match", async () => {
    const { servers } = await read({
      workspace: "C:\\Code\\App",
      platform: "win32",
      claude: {
        projects: {
          "c:/code/app": { mcpServers: { stale: { command: "x" } } },
          "C:\\Code\\App": { mcpServers: { fresh: { command: "x" } } },
        },
      },
    });
    expect(servers.map((s) => s.name)).toEqual(["fresh"]);
  });

  it("does not fold case on Linux", async () => {
    const { servers } = await read({
      workspace: "/home/me/App",
      platform: "linux",
      claude: {
        projects: {
          "/home/me/app": { mcpServers: { wrong: { command: "x" } } },
          "/home/me/other": { mcpServers: { other: { command: "x" } } },
        },
      },
    });
    expect(servers).toEqual([]);
  });

  it("works out project approval from every settings file", async () => {
    const mcpJson = {
      mcpServers: {
        a: { command: "a" },
        b: { command: "b" },
        c: { command: "c" },
        d: { command: "d" },
      },
    };
    const settings = [
      settingsOf("user", { disabledMcpjsonServers: ["c"] }),
      settingsOf("project", { enabledMcpjsonServers: ["a", "c", 5] }),
      settingsOf("local", { enabledMcpjsonServers: ["b"] }),
    ];
    const { servers } = await read({ mcpJson, settings });
    expect(servers.map((s) => [s.name, s.approval])).toEqual([
      ["a", "approved"],
      ["b", "approved"],
      ["c", "rejected"],
      ["d", "pending"],
    ]);
  });

  it("approves every project server with enableAllProjectMcpServers, except rejected ones", async () => {
    const { servers } = await read({
      mcpJson: { mcpServers: { a: { command: "a" }, b: { command: "b" } } },
      settings: [
        settingsOf("local", { enableAllProjectMcpServers: true }),
        settingsOf("managed", { disabledMcpjsonServers: ["b"] }),
      ],
    });
    expect(servers.map((s) => [s.name, s.approval])).toEqual([
      ["a", "approved"],
      ["b", "rejected"],
    ]);
  });

  it("reads servers of enabled plugins only", async () => {
    const d = tmp();
    const wrapped = join(d, "wrapped");
    const flat = join(d, "flat");
    const inline = join(d, "inline");
    const off = join(d, "off");
    put(join(wrapped, ".mcp.json"), {
      mcpServers: { search: { command: "node", env: { API_KEY: "sk-secret-123" } } },
    });
    put(join(flat, ".mcp.json"), { notes: { type: "http", url: "https://n.dev" } });
    put(join(inline, ".claude-plugin", "plugin.json"), {
      name: "inline",
      mcpServers: { db: { command: "db-mcp" } },
    });
    put(join(off, ".mcp.json"), { mcpServers: { hidden: { command: "x" } } });
    const { servers } = await read({
      plugins: [
        plugin("wrapped@m", wrapped, true),
        plugin("flat@m", flat, true),
        plugin("inline@m", inline, true),
        plugin("off@m", off, false),
        plugin("ghost@m", "", true),
      ],
    });
    expect(servers.map((s) => [s.name, s.scope, s.plugin, s.source, s.approval])).toEqual([
      ["search", "plugin", "wrapped@m", join(wrapped, ".mcp.json"), null],
      ["notes", "plugin", "flat@m", join(flat, ".mcp.json"), null],
      ["db", "plugin", "inline@m", join(inline, ".claude-plugin", "plugin.json"), null],
    ]);
    expect(servers[0]!.envKeys).toEqual(["API_KEY"]);
    expect(JSON.stringify(servers)).not.toContain("sk-secret-123");
  });

  it("never throws on broken files", async () => {
    const ws = tmp();
    put(join(ws, ".mcp.json"), '{\n  // servers\n  "mcpServers": {}\n}');
    const { servers } = await read({
      workspace: ws,
      claude: "[1, 2",
      settings: [settingsOf("user", { enabledMcpjsonServers: "all" })],
    });
    expect(servers).toEqual([]);
    const odd = await read({
      claude: { mcpServers: ["a"], projects: "x" },
      mcpJson: { mcpServers: null },
    });
    expect(odd.servers).toEqual([]);
  });
});

describe("readClaudeJson", () => {
  it("parses an unchanged file once and re-reads it when it changes", async () => {
    const p = put(join(tmp(), ".claude.json"), { mcpServers: { a: { command: "x" } } });
    const first = await readClaudeJson(p);
    expect(await readClaudeJson(p)).toBe(first);
    put(p, { mcpServers: { a: { command: "x" }, b: { command: "longer" } } });
    const next = await readClaudeJson(p);
    expect(Object.keys(obj(next.data?.mcpServers) ?? {})).toEqual(["a", "b"]);
  });

  it("reads a large file (long project history) well past the old 4 MB cap", async () => {
    const history = "x".repeat(6 * 1024 * 1024);
    const p = put(join(tmp(), ".claude.json"), { projects: { "/w": { history } }, mcpServers: {} });
    expect(await readClaudeJson(p)).toMatchObject({ error: null, skipped: null });
  });
});
