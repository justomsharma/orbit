import { join } from "node:path";
import { MiB } from "../../core/fsSafe";
import { obj, str } from "../../core/jsonl";
import { normPath } from "../../core/paths";
import { readJsonFile } from "./jsonFile";
import { readPluginMcp } from "./pluginFiles";
import type { InstalledPlugin } from "./plugins";
import type { SettingsFile } from "./settings";

export type McpScope = "user" | "local" | "project" | "plugin";

/** One MCP server. Only the *names* of env vars and headers are kept — never values. */
export interface McpServer {
  name: string;
  scope: McpScope;
  /** File the server is defined in. */
  source: string;
  plugin: string | null;
  transport: "stdio" | "http" | "sse" | "ws" | "unknown";
  command: string | null;
  args: string[];
  url: string | null;
  envKeys: string[];
  headerKeys: string[];
  /** Project servers only: approval from `enabled/disabledMcpjsonServers`. */
  approval: "approved" | "rejected" | "pending" | null;
  problem: string | null;
}

export interface ReadMcpOptions {
  /** Claude's data folder (`~/.claude`). */
  home: string;
  /** `~/.claude.json` (see `claudeJsonPath`). */
  claudeJson: string;
  workspace: string | null;
  settings: SettingsFile[];
  plugins: InstalledPlugin[];
  platform?: NodeJS.Platform;
}

const TRANSPORTS = new Set(["stdio", "http", "sse", "ws"]);
const CLAUDE_JSON_MAX = 4 * MiB;

const keys = (v: unknown) => Object.keys(obj(v) ?? {}).sort();

function toServer(
  name: string,
  def: unknown,
  base: Pick<McpServer, "scope" | "source" | "plugin" | "approval">,
): McpServer {
  const d = obj(def);
  const command = str(d?.command);
  const url = str(d?.url);
  const type = str(d?.type);
  let transport: McpServer["transport"] = "unknown";
  let problem: string | null = null;
  if (!d) problem = "Not a server definition (expected an object)";
  else if (type !== null) {
    if (TRANSPORTS.has(type)) transport = type as McpServer["transport"];
    else problem = `Unknown type "${type}"`;
  } else if (command !== null) transport = "stdio";
  else if (url !== null) transport = "http";
  else problem = "No command or URL set";
  if (transport === "stdio" && !command) problem = "No command set";
  if (transport !== "stdio" && transport !== "unknown" && !url) problem = "No URL set";
  return {
    name,
    ...base,
    transport,
    command,
    args: Array.isArray(d?.args) ? d.args.filter((a): a is string => typeof a === "string") : [],
    url,
    envKeys: keys(d?.env),
    headerKeys: keys(d?.headers),
    problem,
  };
}

/** `projects[<ws>]` of `~/.claude.json`: the exact key if present, else the first samePath match. */
function projectEntry(
  projects: Record<string, unknown> | null,
  workspace: string,
  platform: NodeJS.Platform,
): Record<string, unknown> | null {
  if (!projects) return null;
  if (obj(projects[workspace])) return obj(projects[workspace]);
  const want = normPath(workspace, platform);
  const key = Object.keys(projects).find((k) => normPath(k, platform) === want);
  return key === undefined ? null : obj(projects[key]);
}

/** Approval of a `.mcp.json` server, merged across every settings file. */
function approver(settings: SettingsFile[]) {
  const list = (k: string) =>
    new Set(
      settings.flatMap((s) => {
        const v = s.data?.[k];
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      }),
    );
  const enabled = list("enabledMcpjsonServers");
  const disabled = list("disabledMcpjsonServers");
  const all = settings.some((s) => s.data?.enableAllProjectMcpServers === true);
  return (name: string): McpServer["approval"] => {
    if (disabled.has(name)) return "rejected";
    return all || enabled.has(name) ? "approved" : "pending";
  };
}

/** Every MCP server that applies here: user, local, project, then enabled plugins. */
export async function readMcpServers(opts: ReadMcpOptions): Promise<McpServer[]> {
  const { claudeJson, workspace, settings, plugins, platform = process.platform } = opts;
  const out: McpServer[] = [];
  const addAll = (
    servers: unknown,
    base: Omit<Parameters<typeof toServer>[2], "approval">,
    approve: (name: string) => McpServer["approval"] = () => null,
  ) => {
    for (const [name, def] of Object.entries(obj(servers) ?? {}))
      out.push(toServer(name, def, { ...base, approval: approve(name) }));
  };

  const cj = (await readJsonFile(claudeJson, CLAUDE_JSON_MAX)).data;
  addAll(cj?.mcpServers, { scope: "user", source: claudeJson, plugin: null });
  if (workspace) {
    const entry = projectEntry(obj(cj?.projects), workspace, platform);
    addAll(entry?.mcpServers, { scope: "local", source: claudeJson, plugin: null });
    const mcpJson = await readJsonFile(join(workspace, ".mcp.json"));
    addAll(
      mcpJson.data?.mcpServers,
      { scope: "project", source: mcpJson.path, plugin: null },
      approver(settings),
    );
  }

  const live = plugins.filter((p) => p.enabled && p.installPath);
  const defs = await Promise.all(live.map((p) => readPluginMcp(p.installPath)));
  live.forEach((p, i) => {
    for (const d of defs[i] ?? [])
      out.push(
        toServer(d.name, d.def, {
          scope: "plugin",
          source: d.source,
          plugin: p.id,
          approval: null,
        }),
      );
  });
  return out;
}
