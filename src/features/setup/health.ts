/**
 * The Setup health check: plain-language problems in a person's Claude Code
 * setup, most serious first, each with where to look and a prompt Claude can
 * use to fix it. Pure — every file-system fact arrives in `HealthInput`.
 */
import * as path from "node:path";
import type { AgentInfo } from "./agents";
import { settingsCatalog, unknownKeys } from "./catalog";
import type { CommandInfo } from "./commands";
import type { HookEntry } from "./hooks";
import type { JsonFile } from "./jsonFile";
import type { McpServer } from "./mcp";
import type { MemoryInfo } from "./memory";
import type { Permissions } from "./permissions";
import type { InstalledPlugin } from "./plugins";
import type { SettingsFile } from "./settings";
import type { SkillInfo } from "./skills";

export type Severity = "error" | "warning" | "info";
export type Area =
  | "settings"
  | "mcp"
  | "plugins"
  | "hooks"
  | "permissions"
  | "skills"
  | "agents"
  | "commands"
  | "memory";

export type Fix = { kind: "approveMcp"; name: string };

export interface Issue {
  id: string;
  severity: Severity;
  area: Area;
  title: string;
  detail: string;
  file: string | null;
  fix: Fix | null;
  /** What to ask Claude, for a one-click "Fix with Claude". */
  claudePrompt: string | null;
}

export interface HealthInput {
  settings: SettingsFile[];
  claudeJson: JsonFile | null;
  mcpJson: JsonFile | null;
  plugins: InstalledPlugin[];
  mcp: McpServer[];
  hooks: HookEntry[];
  permissions: Permissions;
  skills: SkillInfo[];
  agents: AgentInfo[];
  commands: CommandInfo[];
  memory: MemoryInfo;
  /** stdio MCP commands that were not found on PATH or on disk. */
  missingCommands: Set<string>;
  /** Ids of hooks whose script file does not exist. */
  missingHookScripts: Set<string>;
}

const MEMORY_INDEX_LINES = 200;
const MEMORY_INDEX_BYTES = 25 * 1024;
const BIG_CLAUDE_MD = 40 * 1024;
const SCOPE_WORD = {
  user: "user",
  project: "shared project",
  local: "local project",
  managed: "managed",
} as const;

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n]!;
}

/** The official setting a typo most likely meant, or null. */
export function closestKey(key: string): string | null {
  let best: string | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const d of settingsCatalog()) {
    const dist = distance(key.toLowerCase(), d.key.toLowerCase());
    if (dist < bestD) {
      bestD = dist;
      best = d.key;
    }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(key.length / 4)) ? best : null;
}

const INTERPRETERS = new Set([
  "bash",
  "sh",
  "zsh",
  "node",
  "python",
  "python3",
  "pwsh",
  "powershell",
  "deno",
  "bun",
  "ruby",
  "perl",
]);

/** Splits a command line into words, honouring simple quotes. */
function words(cmd: string): string[] {
  const out: string[] = [];
  for (const m of cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/**
 * The script file a hook command runs, when it names one (a path, or the file
 * given to an interpreter like `bash x.sh`). Null for plain programs such as `jq`.
 */
export function hookScriptPath(
  command: string,
  projectDir: string | null,
  userHome: string,
): string | null {
  const w = words(command);
  let token = w[0] ?? "";
  if (
    INTERPRETERS.has(
      path
        .basename(token)
        .replace(/\.exe$/i, "")
        .toLowerCase(),
    )
  )
    token = w[1] ?? "";
  if (!token) return null;
  const expanded = token
    .replace(/^\$\{CLAUDE_PROJECT_DIR\}|^\$CLAUDE_PROJECT_DIR/, projectDir ?? "$CLAUDE_PROJECT_DIR")
    .replace(/^\$\{HOME\}|^\$HOME|^~(?=[\\/])/, userHome);
  if (expanded.startsWith("$")) return null;
  const looksLikeFile =
    /[\\/]/.test(expanded) || /\.(sh|js|mjs|cjs|ts|py|ps1|rb|pl)$/i.test(expanded);
  if (!looksLikeFile) return null;
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return projectDir ? path.resolve(projectDir, expanded) : null;
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function checkHealth(h: HealthInput): Issue[] {
  const out: Issue[] = [];
  const add = (
    i: Omit<Issue, "fix" | "claudePrompt"> & Partial<Pick<Issue, "fix" | "claudePrompt">>,
  ) => out.push({ fix: null, claudePrompt: null, ...i });

  // Settings files
  for (const s of h.settings) {
    const where = SCOPE_WORD[s.scope];
    if (s.exists && s.error) {
      add({
        id: `settings-error:${s.scope}`,
        severity: "error",
        area: "settings",
        title: `Claude can't read your ${where} settings`,
        detail: `${s.error}. Claude Code ignores this file until it's fixed.`,
        file: s.path,
        claudePrompt: `My Claude Code ${where} settings file at ${s.path} has an error: ${s.error}. Please fix the JSON without changing any setting values.`,
      });
    }
    if (s.data) {
      for (const key of unknownKeys(s.data)) {
        const guess = closestKey(key);
        add({
          id: `settings-unknown:${s.scope}:${key}`,
          // A near miss is most likely a typo Claude ignores; anything else may just be newer.
          severity: guess ? "warning" : "info",
          area: "settings",
          title: `Unknown setting "${key}" in your ${where} settings`,
          detail: guess
            ? `Claude Code ignores it. Did you mean "${guess}"?`
            : "It isn't in Claude Code's published settings list. It may be newer than Orbit's list, or no longer used.",
          file: s.path,
          claudePrompt: guess
            ? `In ${s.path}, the setting "${key}" is unknown to Claude Code. If it's a typo for "${guess}", rename it; otherwise explain what it was meant to do.`
            : null,
        });
      }
    }
  }
  for (const [f, label] of [
    [h.claudeJson, "Claude's global config (~/.claude.json)"],
    [h.mcpJson, "this project's .mcp.json"],
  ] as const) {
    if (f?.exists && f.error) {
      add({
        id: `json-error:${f.path}`,
        severity: "error",
        area: "mcp",
        title: `Claude can't read ${label}`,
        detail: `${f.error}. MCP servers defined there won't load.`,
        file: f.path,
        claudePrompt: `The file ${f.path} has an error: ${f.error}. Please fix the JSON without changing any values.`,
      });
    }
  }

  // MCP servers
  for (const m of h.mcp) {
    if (m.transport === "stdio" && m.command && h.missingCommands.has(m.command)) {
      add({
        id: `mcp-command:${m.scope}:${m.name}`,
        severity: "error",
        area: "mcp",
        title: `MCP server "${m.name}" can't start`,
        detail: `Its command "${m.command}" wasn't found. Install it or fix the path.`,
        file: m.plugin ? null : m.source,
        claudePrompt: `My MCP server "${m.name}" runs the command "${m.command}", which isn't installed or isn't on my PATH. Help me install it or correct the server configuration.`,
      });
    } else if (m.problem) {
      add({
        id: `mcp-problem:${m.scope}:${m.name}`,
        severity: "warning",
        area: "mcp",
        title: `MCP server "${m.name}" looks incomplete`,
        detail: m.problem,
        file: m.plugin ? null : m.source,
      });
    }
    if (m.scope === "project" && m.approval === "pending") {
      add({
        id: `mcp-pending:${m.name}`,
        severity: "info",
        area: "mcp",
        title: `Project MCP server "${m.name}" is waiting for approval`,
        detail: "Claude won't use it in this project until you approve it.",
        file: m.source,
        fix: { kind: "approveMcp", name: m.name },
      });
    }
  }

  // Plugins
  for (const p of h.plugins) {
    if (!p.problem) continue;
    add({
      id: `plugin:${p.id}`,
      severity: "warning",
      area: "plugins",
      title: `Plugin "${p.name}": ${p.problem.toLowerCase()}`,
      detail:
        p.problem === "Enabled but not installed"
          ? "It's turned on in your settings, but its files aren't installed. Reinstall it with /plugin or turn it off."
          : p.problem,
      file: null,
    });
  }

  // Hooks
  for (const hk of h.hooks) {
    if (!h.missingHookScripts.has(hk.id)) continue;
    add({
      id: `hook-script:${hk.id}`,
      severity: "error",
      area: "hooks",
      title: `A ${hk.event} hook runs a script that doesn't exist`,
      detail: `"${hk.command}" will fail every time it runs.`,
      file: hk.plugin ? null : hk.source,
      claudePrompt: `My Claude Code ${hk.event} hook runs "${hk.command}", but that script doesn't exist. Help me restore the script or remove the hook.`,
    });
  }

  // Permissions
  for (const r of h.permissions.rules) {
    if (r.list === "allow" && /^Bash(\(\*\)|\(\*:\*\))?$/.test(r.rule)) {
      add({
        id: `perm-bash:${r.scope}`,
        severity: "warning",
        area: "permissions",
        title: "Claude may run every shell command without asking",
        detail: `Your ${SCOPE_WORD[r.scope]} settings allow "${r.rule}". Consider allowing specific commands instead, like Bash(npm test).`,
        file: h.settings.find((s) => s.scope === r.scope)?.path ?? null,
      });
    }
  }
  const lists = new Map<string, Set<string>>();
  for (const r of h.permissions.rules) {
    const set = lists.get(r.rule) ?? new Set<string>();
    set.add(r.list);
    lists.set(r.rule, set);
  }
  for (const [rule, set] of lists) {
    if (set.has("allow") && set.has("deny")) {
      add({
        id: `perm-both:${rule}`,
        severity: "info",
        area: "permissions",
        title: `"${rule}" is both allowed and denied`,
        detail: "Deny wins, so Claude will never be allowed to do this.",
        file: null,
      });
    }
  }
  for (const m of h.permissions.defaultMode) {
    if (m.mode === "bypassPermissions") {
      add({
        id: `perm-bypass:${m.scope}`,
        severity: "warning",
        area: "permissions",
        title: "Claude starts in bypass-permissions mode",
        detail:
          "Every action runs without asking. Anthropic recommends this only in isolated sandboxes.",
        file: h.settings.find((s) => s.scope === m.scope)?.path ?? null,
      });
    }
  }

  // Skills, agents, commands
  const content: [Area, { name: string; file: string; problems: string[] }[]][] = [
    ["skills", h.skills],
    ["agents", h.agents],
    ["commands", h.commands],
  ];
  const noun: Record<string, string> = { skills: "Skill", agents: "Agent", commands: "Command" };
  for (const [area, items] of content) {
    for (const it of items) {
      for (const p of it.problems) {
        add({
          id: `${area}:${it.file}:${p}`,
          severity: "warning",
          area,
          title: `${noun[area]} "${it.name}": ${p.charAt(0).toLowerCase()}${p.slice(1)}`,
          detail: "Claude may not use it the way you expect.",
          file: it.file,
          claudePrompt: `My Claude Code ${noun[area]!.toLowerCase()} "${it.name}" at ${it.file} has a problem: ${p}. Please fix it.`,
        });
      }
    }
  }

  // Memory
  for (const f of h.memory.claudeMd) {
    for (const imp of f.imports) {
      if (imp.exists) continue;
      add({
        id: `claudemd-import:${f.path}:${imp.ref}`,
        severity: "warning",
        area: "memory",
        title: `CLAUDE.md imports a missing file`,
        detail: `${imp.ref} in ${path.basename(f.path)} points to ${imp.path}, which doesn't exist.`,
        file: f.path,
      });
    }
    if (f.bytes > BIG_CLAUDE_MD) {
      add({
        id: `claudemd-big:${f.path}`,
        severity: "info",
        area: "memory",
        title: `${path.basename(f.path)} is large (${Math.round(f.bytes / 1024)} KB)`,
        detail:
          "It's added to every conversation, which uses context. Consider moving details into skills.",
        file: f.path,
      });
    }
  }
  const idx = h.memory.auto;
  if (
    idx.indexPath &&
    (idx.indexLines > MEMORY_INDEX_LINES || idx.indexBytes > MEMORY_INDEX_BYTES)
  ) {
    add({
      id: "memory-index-long",
      severity: "warning",
      area: "memory",
      title: "Claude only reads the first 200 lines of MEMORY.md",
      detail: `Yours has ${idx.indexLines} lines (${Math.round(idx.indexBytes / 1024)} KB), so later memories are never loaded. Shorten or reorganise it.`,
      file: idx.indexPath,
      claudePrompt: `My auto-memory index ${idx.indexPath} is longer than the 200 lines Claude Code loads. Please shorten it while keeping every important pointer.`,
    });
  }
  for (const f of idx.files) {
    if (!f.brokenLinks.length) continue;
    add({
      id: `memory-links:${f.path}`,
      severity: "info",
      area: "memory",
      title: `Memory "${f.title ?? f.name}" links to memories that don't exist`,
      detail: f.brokenLinks.map((l) => `[[${l}]]`).join(", "),
      file: f.path,
    });
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
