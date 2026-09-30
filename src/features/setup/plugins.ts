import { join } from "node:path";
import { listDirSafe, statSafe } from "../../core/fsSafe";
import { obj, str } from "../../core/jsonl";
import { samePath } from "../../core/paths";
import { readHooks } from "./hooks";
import { readJsonFile } from "./jsonFile";
import { readPluginHooksFile, readPluginManifest, readPluginMcp } from "./pluginFiles";
import { byPrecedence, type SettingsFile, type SettingsScope } from "./settings";

export interface PluginCounts {
  skills: number;
  agents: number;
  commands: number;
  hooks: number;
  mcpServers: number;
}

export interface InstalledPlugin {
  /** `<name>@<marketplace>`. */
  id: string;
  name: string;
  marketplace: string;
  scope: "user" | "project" | "local";
  projectPath: string | null;
  /** Empty when the plugin is enabled in settings but not installed. */
  installPath: string;
  version: string;
  description: string | null;
  /** Effective value: the highest-precedence settings file that names the plugin decides. */
  enabled: boolean;
  /** Scopes whose `enabledPlugins` sets the plugin to `true`. */
  enabledIn: SettingsScope[];
  counts: PluginCounts;
  problem: string | null;
}

interface Install {
  scope: InstalledPlugin["scope"];
  projectPath: string | null;
  installPath: string;
  version: string;
}

const ZERO: PluginCounts = { skills: 0, agents: 0, commands: 0, hooks: 0, mcpServers: 0 };
const SCOPES = new Set(["user", "project", "local"]);
/** Deep enough for any real `commands/` tree, bounded against odd folders. */
const MAX_DEPTH = 8;

/** Splits at the last `@`: `a@b@mkt` → `a@b` + `mkt`. */
export function splitPluginId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf("@");
  return at < 0
    ? { name: id, marketplace: "" }
    : { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

function toInstall(v: unknown): Install | null {
  const r = obj(v);
  if (!r) return null;
  const scope = str(r.scope) ?? "user";
  if (!SCOPES.has(scope)) return null;
  return {
    scope: scope as Install["scope"],
    projectPath: str(r.projectPath),
    installPath: str(r.installPath) ?? "",
    version: str(r.version) ?? "",
  };
}

/** `installed_plugins.json` as `id → installs`; tolerates the legacy flat map. */
async function readInstalled(home: string): Promise<Map<string, Install[]>> {
  const f = await readJsonFile(join(home, "plugins", "installed_plugins.json"));
  const out = new Map<string, Install[]>();
  if (!f.data) return out;
  const plugins = obj(f.data.plugins) ?? (f.data.plugins === undefined ? f.data : null);
  for (const [id, v] of Object.entries(plugins ?? {})) {
    if (id === "version" && plugins === f.data) continue;
    const list = (Array.isArray(v) ? v : [v]).map(toInstall).filter((i): i is Install => !!i);
    if (list.length) out.set(id, list);
  }
  return out;
}

function relevant(i: Install, workspace: string | null, platform: NodeJS.Platform): boolean {
  if (i.scope === "user") return true;
  return !!workspace && !!i.projectPath && samePath(i.projectPath, workspace, platform);
}

/** Effective enabled value and the scopes that turn it on. */
function enabledState(id: string, settings: SettingsFile[]) {
  let enabled: boolean | null = null;
  for (const s of byPrecedence(settings)) {
    const v = obj(s.data?.enabledPlugins)?.[id];
    if (typeof v === "boolean") {
      enabled = v;
      break;
    }
  }
  const enabledIn = settings
    .filter((s) => obj(s.data?.enabledPlugins)?.[id] === true)
    .map((s) => s.scope);
  return { enabled: enabled ?? false, enabledIn };
}

async function countFiles(dir: string, match: (name: string) => boolean, depth: number) {
  let n = 0;
  for (const e of await listDirSafe(dir)) {
    if (e.isFile() && match(e.name)) n++;
    else if (e.isDirectory() && depth > 0)
      n += await countFiles(join(dir, e.name), match, depth - 1);
  }
  return n;
}

async function countSkills(dir: string) {
  const dirs = (await listDirSafe(dir)).filter((e) => e.isDirectory());
  const found = await Promise.all(dirs.map((e) => statSafe(join(dir, e.name, "SKILL.md"))));
  return found.filter((st) => st?.isFile()).length;
}

/** Description, component counts and any problem, from the plugin's own folder. */
async function inspect(installPath: string, id: string) {
  const st = installPath ? await statSafe(installPath) : null;
  if (!st?.isDirectory())
    return { description: null, counts: ZERO, problem: "Plugin files are missing" };
  const manifest = await readPluginManifest(installPath);
  const isMd = (n: string) => n.toLowerCase().endsWith(".md");
  const [skills, agents, commands, hooksFile, servers] = await Promise.all([
    countSkills(join(installPath, "skills")),
    countFiles(join(installPath, "agents"), isMd, 0),
    countFiles(join(installPath, "commands"), isMd, MAX_DEPTH),
    readPluginHooksFile(installPath),
    readPluginMcp(installPath, manifest),
  ]);
  const hooks = hooksFile.data
    ? readHooks([], [{ plugin: id, source: hooksFile.path, data: hooksFile.data }]).length
    : 0;
  return {
    description: str(manifest.data?.description),
    counts: { skills, agents, commands, hooks, mcpServers: servers.length },
    problem: manifest.error ? `Plugin manifest: ${manifest.error}` : null,
  };
}

/**
 * Plugins that apply here: user installs, plus project/local installs for this
 * folder. Also lists ids enabled in settings that have no install here.
 * `home` is Claude's data folder (`~/.claude`).
 */
export async function readPlugins(
  home: string,
  settings: SettingsFile[],
  workspace: string | null,
  platform: NodeJS.Platform = process.platform,
): Promise<InstalledPlugin[]> {
  const installed = await readInstalled(home);
  const jobs: Promise<InstalledPlugin>[] = [];
  const seen = new Set<string>();
  for (const [id, installs] of installed) {
    for (const i of installs.filter((x) => relevant(x, workspace, platform))) {
      seen.add(id);
      jobs.push(
        inspect(i.installPath, id).then((info) => ({
          id,
          ...splitPluginId(id),
          ...i,
          ...info,
          ...enabledState(id, settings),
        })),
      );
    }
  }
  const out = await Promise.all(jobs);
  const named = new Set(settings.flatMap((s) => Object.keys(obj(s.data?.enabledPlugins) ?? {})));
  for (const id of named) {
    if (seen.has(id)) continue;
    const state = enabledState(id, settings);
    if (!state.enabled) continue;
    out.push({
      id,
      ...splitPluginId(id),
      scope: "user",
      projectPath: null,
      installPath: "",
      version: "",
      description: null,
      ...state,
      counts: ZERO,
      problem: "Enabled but not installed",
    });
  }
  return out;
}
