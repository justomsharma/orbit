import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { type AgentInfo, readAgents } from "../features/setup/agents";
import { effectiveSetting } from "../features/setup/catalog";
import { type CommandInfo, readCommands } from "../features/setup/commands";
import { checkHealth, hookScriptPath, type Issue } from "../features/setup/health";
import { type HookEntry, readHooks, readPluginHooks } from "../features/setup/hooks";
import { type Marketplace, readMarketplaces } from "../features/setup/marketplaces";
import { type McpServer, readClaudeJson, readMcpJson, readMcpServers } from "../features/setup/mcp";
import {
  listMemoryProjects,
  type MemoryInfo,
  type MemoryProject,
  readMemory,
} from "../features/setup/memory";
import { type ModelOption, modelOptions } from "../features/setup/models";
import { type PausedHook, type PausedHookView, pausedFor } from "../features/setup/pausedHooks";
import { type Permissions, readPermissions } from "../features/setup/permissions";
import { type InstalledPlugin, readPlugins } from "../features/setup/plugins";
import { redactArgs, redactText, redactUrl } from "../features/setup/redact";
import {
  decidingScope,
  readSettingsFiles,
  type SettingsFile,
  type SettingsScope,
} from "../features/setup/settings";
import { readSkills, type SkillInfo } from "../features/setup/skills";

/** What the Settings editor may see of a value. Secrets never leave the host. */
export type SettingValue =
  | { value: string | number | boolean }
  | { keys: string[] }
  | { entries: Record<string, string | number | boolean> }
  | { count: number }
  | { hidden: true };

/** Objects whose values are plain choices (never secrets) and are shown in full. */
const OPEN_OBJECTS = new Set(["skillOverrides", "enabledPlugins"]);

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
  /** Models Config offers: Claude's aliases plus extras this account has. */
  modelOptions: ModelOption[];
  /** MCP servers Claude Code says need signing in again (`mcp-needs-auth-cache.json`). */
  mcpNeedsAuth: string[];
  /** Launch commands of stdio MCP servers that aren't on PATH. */
  missingCommands: string[];
  /** Hooks Orbit paused (taken out of their file, kept in Orbit's storage). */
  pausedHooks: PausedHookView[];
  /** Where plugins are installed from. */
  marketplaces: Marketplace[];
  /** Every project folder with auto memories (for Memory's project picker). */
  memoryProjects: MemoryProject[];
  /** Settings inside objects that Config shows (sandbox, bypass block): value and where it's set. */
  nested: Record<string, { scope: SettingsScope; value: string | number | boolean } | null>;
}

/** Names in Claude Code's "needs sign-in" cache, if any. */
async function needsAuth(home: string): Promise<string[]> {
  try {
    const o = JSON.parse(await readFile(path.join(home, "mcp-needs-auth-cache.json"), "utf8"));
    return o && typeof o === "object" && !Array.isArray(o)
      ? Object.keys(o)
          .filter((k) => k.length <= 200)
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}

/** The nested settings Config's quick settings show. */
export const NESTED_KEYS = [
  "permissions.defaultMode",
  "sandbox.enabled",
  "permissions.disableBypassPermissionsMode",
  "voice.enabled",
  "attribution.commit",
  "attribution.pr",
] as const;

/** A setting inside an object setting, from the file that decides it. */
export function nestedSetting(
  files: SettingsFile[],
  key: string,
): { scope: SettingsScope; value: string | number | boolean } | null {
  const path = key.split(".");
  const scope = decidingScope(files, path);
  if (!scope) return null;
  let v: unknown = files.find((f) => f.scope === scope)?.data;
  for (const k of path)
    v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
    ? { scope, value: v }
    : null;
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
  if (OPEN_OBJECTS.has(key) && v && typeof v === "object") {
    const entries: Record<string, string | number | boolean> = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") entries[k] = x;
    }
    return { entries };
  }
  if (v && typeof v === "object") return { keys: Object.keys(v).sort() };
  return { hidden: true };
}

function toView(f: SettingsFile): SettingsView {
  const values: Record<string, SettingValue> = {};
  for (const [k, v] of Object.entries(f.data ?? {})) values[k] = viewValue(k, v);
  return { scope: f.scope, path: f.path, exists: f.exists, error: f.error, values };
}

const maybe = <T>(v: T | null, f: (v: T) => T): T | null => (v === null ? null : f(v));

/**
 * The snapshot as the webview may see it: tokens in MCP args, URLs and commands,
 * hook commands and URLs, and the issue text quoting them become "•••". Ids,
 * paths and names are unchanged, so actions from the view still match the host
 * snapshot, which keeps the real values (removing a hook compares against them).
 * Everything posted to the view goes through here.
 */
export function viewSnapshot(s: SetupSnapshot): SetupSnapshot {
  return {
    ...s,
    mcp: s.mcp.map((m) => ({
      ...m,
      command: maybe(m.command, redactText),
      args: redactArgs(m.args),
      url: maybe(m.url, redactUrl),
    })),
    hooks: s.hooks.map((h) => ({
      ...h,
      command: maybe(h.command, redactText),
      url: maybe(h.url, redactUrl),
    })),
    marketplaces: s.marketplaces.map((m) => ({ ...m, source: redactText(m.source) })),
    pausedHooks: s.pausedHooks.map((h) => ({
      ...h,
      command: maybe(h.command, redactText),
      url: maybe(h.url, redactUrl),
    })),
    // Claude saves exact commands as rules ("don't ask again"), tokens included.
    permissions: {
      ...s.permissions,
      rules: s.permissions.rules.map((r) => ({ ...r, rule: redactText(r.rule) })),
    },
    skills: s.skills.map((k) => ({ ...k, allowedTools: k.allowedTools.map(redactText) })),
    issues: s.issues.map((i) => ({
      ...i,
      id: redactText(i.id),
      title: redactText(i.title),
      detail: redactText(i.detail),
      claudePrompt: maybe(i.claudePrompt, redactText),
    })),
  };
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
  /** Hooks Orbit paused. */
  pausedHooks?: () => Promise<PausedHook[]>;
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
    // Read once: it can be large, and both the MCP list and the health check need it.
    const claudeJson = await readClaudeJson(this.d.claudeJson);
    const [mcp, pluginHooks, skills, agents, commands, memory, mcpJson] = await Promise.all([
      readMcpServers({
        home,
        claudeJson: this.d.claudeJson,
        claudeJsonFile: claudeJson,
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
      workspace ? readMcpJson(workspace) : Promise.resolve(null),
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
      platform: this.d.platform,
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
      modelOptions: modelOptions(claudeJson.data),
      mcpNeedsAuth: await needsAuth(home),
      missingCommands: [...missingCommands],
      marketplaces: await readMarketplaces(home),
      memoryProjects: await listMemoryProjects(home),
      pausedHooks: pausedFor(
        (await this.d.pausedHooks?.().catch(() => [])) ?? [],
        settings.filter((f) => f.scope !== "managed").map((f) => f.path),
        hooks,
        platform,
      ),
      nested: Object.fromEntries(NESTED_KEYS.map((k) => [k, nestedSetting(settings, k)])),
    };
  }
}
