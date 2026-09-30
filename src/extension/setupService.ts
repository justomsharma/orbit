import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import { type AgentInfo, readAgents } from "../features/setup/agents";
import { effectiveSetting } from "../features/setup/catalog";
import { type CommandInfo, readCommands } from "../features/setup/commands";
import { checkHealth, hookScriptPath, type Issue } from "../features/setup/health";
import { type HookEntry, readHooks, readPluginHooks } from "../features/setup/hooks";
import { readJsonFile } from "../features/setup/jsonFile";
import { type McpServer, readMcpServers } from "../features/setup/mcp";
import { type MemoryInfo, readMemory } from "../features/setup/memory";
import { type Permissions, readPermissions } from "../features/setup/permissions";
import { type InstalledPlugin, readPlugins } from "../features/setup/plugins";
import {
  readSettingsFiles,
  type SettingsFile,
  type SettingsScope,
} from "../features/setup/settings";
import { readSkills, type SkillInfo } from "../features/setup/skills";

/** What the Settings editor may see of a value. Secrets never leave the host. */
export type SettingValue =
  | { value: string | number | boolean }
  | { keys: string[] }
  | { count: number }
  | { hidden: true };

export interface SettingsView {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  error: string | null;
  values: Record<string, SettingValue>;
}

export interface SetupSnapshot {
  workspace: string | null;
  settings: SettingsView[];
  plugins: InstalledPlugin[];
  mcp: McpServer[];
  hooks: HookEntry[];
  permissions: Permissions;
  skills: SkillInfo[];
  agents: AgentInfo[];
  commands: CommandInfo[];
  memory: MemoryInfo;
  issues: Issue[];
  claudeJsonPath: string;
}

/** Settings whose values can be credentials or personal helper scripts: shown as "set" only. */
const HIDDEN = new Set([
  "apiKeyHelper",
  "awsCredentialExport",
  "awsAuthRefresh",
  "gcpAuthRefresh",
  "otelHeadersHelper",
  "forceLoginOrgUUID",
  "policyHelper",
]);
const SECRETISH = /(token|secret|password|apikey|credential)/i;

export function viewValue(key: string, v: unknown): SettingValue {
  if (HIDDEN.has(key) || SECRETISH.test(key)) return { hidden: true };
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return { value: v };
  if (Array.isArray(v)) return { count: v.length };
  if (v && typeof v === "object") return { keys: Object.keys(v).sort() };
  return { hidden: true };
}

function toView(f: SettingsFile): SettingsView {
  const values: Record<string, SettingValue> = {};
  for (const [k, v] of Object.entries(f.data ?? {})) values[k] = viewValue(k, v);
  return { scope: f.scope, path: f.path, exists: f.exists, error: f.error, values };
}

export interface SetupDeps {
  /** Claude's data folder (`~/.claude`). */
  home: string;
  /** `~/.claude.json`. */
  claudeJson: string;
  userHome: string;
  platform: NodeJS.Platform;
  /** Is a bare program name (like `npx`) on PATH? */
  commandExists?: (cmd: string) => Promise<boolean>;
}

const exists = async (p: string) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

/** PATH lookup with `where`/`which` (no shell), cached for a few minutes. */
export function pathLookup(platform: NodeJS.Platform): (cmd: string) => Promise<boolean> {
  const cache = new Map<string, { at: number; ok: boolean }>();
  return async (cmd) => {
    const hit = cache.get(cmd);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
    const ok = await new Promise<boolean>((resolve) => {
      execFile(
        platform === "win32" ? "where" : "which",
        [cmd],
        { timeout: 5000, windowsHide: true },
        (err) => resolve(!err),
      );
    });
    cache.set(cmd, { at: Date.now(), ok });
    return ok;
  };
}

/** Reads the whole Claude Code setup for the open folder and runs the health check. */
export class SetupService {
  private readonly commandExists: (cmd: string) => Promise<boolean>;

  constructor(private readonly d: SetupDeps) {
    this.commandExists = d.commandExists ?? pathLookup(d.platform);
  }

  async snapshot(workspace: string | null): Promise<SetupSnapshot> {
    const { home, platform } = this.d;
    const settings = await readSettingsFiles(home, workspace, platform);
    const plugins = await readPlugins(home, settings, workspace, platform);
    const roots = plugins
      .filter((p) => p.enabled && p.installPath)
      .map((p) => ({ id: p.id, installPath: p.installPath }));
    const memorySettings = {
      autoMemoryEnabled: effectiveSetting(settings, "autoMemoryEnabled")?.value,
      autoMemoryDirectory: effectiveSetting(settings, "autoMemoryDirectory")?.value,
    };
    const [mcp, pluginHooks, skills, agents, commands, memory, claudeJson, mcpJson] =
      await Promise.all([
        readMcpServers({
          home,
          claudeJson: this.d.claudeJson,
          workspace,
          settings,
          plugins,
          platform,
        }),
        readPluginHooks(plugins),
        readSkills(home, workspace, roots),
        readAgents(home, workspace, roots),
        readCommands(home, workspace, roots),
        readMemory({
          home,
          workspace,
          settings: memorySettings,
          platform,
          userHome: this.d.userHome,
        }),
        readJsonFile(this.d.claudeJson, 4 * 1024 * 1024),
        workspace ? readJsonFile(path.join(workspace, ".mcp.json")) : Promise.resolve(null),
      ]);
    const hooks = readHooks(settings, pluginHooks);
    const permissions = readPermissions(settings);

    const missingCommands = new Set<string>();
    for (const m of mcp) {
      if (m.transport !== "stdio" || !m.command || missingCommands.has(m.command)) continue;
      const cmd = m.command;
      const found = /[\\/]/.test(cmd)
        ? await exists(
            path.resolve(workspace ?? this.d.userHome, cmd.replace(/^~(?=[\\/])/, this.d.userHome)),
          )
        : await this.commandExists(cmd);
      if (!found) missingCommands.add(cmd);
    }
    const missingHookScripts = new Set<string>();
    for (const h of hooks) {
      if (h.type !== "command" || !h.command || h.plugin) continue;
      const script = hookScriptPath(h.command, workspace, this.d.userHome);
      if (script && !(await exists(script))) missingHookScripts.add(h.id);
    }

    const issues = checkHealth({
      settings,
      claudeJson,
      mcpJson,
      plugins,
      mcp,
      hooks,
      permissions,
      skills,
      agents,
      commands,
      memory,
      missingCommands,
      missingHookScripts,
    });
    return {
      workspace,
      settings: settings.map(toView),
      plugins,
      mcp,
      hooks,
      permissions,
      skills,
      agents,
      commands,
      memory,
      issues,
      claudeJsonPath: this.d.claudeJson,
    };
  }
}
