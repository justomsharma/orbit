import { join } from "node:path";
import { obj } from "../../core/jsonl";
import { type JsonFile, readJsonFile } from "./jsonFile";

/** `<installPath>/.claude-plugin/plugin.json`. */
export const manifestPath = (installPath: string) =>
  join(installPath, ".claude-plugin", "plugin.json");

export const readPluginManifest = (installPath: string): Promise<JsonFile> =>
  readJsonFile(manifestPath(installPath));

export const readPluginHooksFile = (installPath: string): Promise<JsonFile> =>
  readJsonFile(join(installPath, "hooks", "hooks.json"));

/** One MCP server definition found in a plugin, not yet interpreted. */
export interface PluginServerDef {
  name: string;
  def: unknown;
  source: string;
}

/**
 * MCP servers a plugin brings: `.mcp.json` (`{ mcpServers }` or a flat map of
 * servers), then inline `mcpServers` in the manifest. `manifest` is passed in
 * when the caller has already read it.
 */
export async function readPluginMcp(
  installPath: string,
  manifest?: JsonFile,
): Promise<PluginServerDef[]> {
  const [mcp, man] = await Promise.all([
    readJsonFile(join(installPath, ".mcp.json")),
    manifest ?? readPluginManifest(installPath),
  ]);
  const out: PluginServerDef[] = [];
  const add = (servers: Record<string, unknown> | null, source: string) => {
    for (const [name, def] of Object.entries(servers ?? {})) out.push({ name, def, source });
  };
  if (mcp.data) add("mcpServers" in mcp.data ? obj(mcp.data.mcpServers) : mcp.data, mcp.path);
  add(obj(man.data?.mcpServers), man.path);
  return out;
}
