# Stage 3 — Setup (see everything, fix anything, safely)

> Executors: Tasks 1–2 subagents in parallel worktrees (readers), Tasks 3–6 native. Stage reviewer at the end.

**Goal:** One Setup tab showing every part of the person's Claude Code setup, a health check that finds real problems, and safe edits (preview → backup → apply → undo) using only official keys.
**Spec:** `docs/specs/2026-09-30-orbit-design.md`

## Verified facts (CLI 2.1.285 help + json.schemastore.org/claude-code-settings.json + code.claude.com/docs)
- Settings scopes: user `~/.claude/settings.json`, project `<ws>/.claude/settings.json`, local `<ws>/.claude/settings.local.json`, managed (win `C:\Program Files\ClaudeCode\managed-settings.json`, mac `/Library/Application Support/ClaudeCode/managed-settings.json`, linux `/etc/claude-code/managed-settings.json`) — read-only for Orbit. Precedence managed > local > project > user; arrays like `permissions.allow` merge.
- MCP: user = `~/.claude.json` `mcpServers`; local = `~/.claude.json` `projects[<abs ws path>].mcpServers`; project = `<ws>/.mcp.json` `mcpServers`; plugin = plugin `.mcp.json` / manifest `mcpServers`. Project approval: `enabledMcpjsonServers` / `disabledMcpjsonServers` / `enableAllProjectMcpServers` in settings. There is NO official per-server disable for user/local servers (no `claude mcp disable`) → Orbit offers remove (with undo), not a fake toggle.
- Hooks: `hooks.<Event>[] = { matcher?, hooks: [{ type: "command"|"http"|"mcp_tool"|"prompt"|"agent", command?, args?, url?, timeout?, if? }] }`; global off: `disableAllHooks`. No per-hook disable → remove (with undo).
- Skills `~/.claude/skills/<n>/SKILL.md`, `<ws>/.claude/skills/<n>/SKILL.md`, plugin `skills/`; visibility via `skillOverrides: { "<name>": "on" | "name-only" | "off" }`.
- Commands (legacy) `~/.claude/commands/**/*.md`, `<ws>/.claude/commands/**/*.md` (subfolder = namespace `a:b`).
- Agents `~/.claude/agents/*.md`, `<ws>/.claude/agents/*.md`, plugin `agents/`.
- Plugins: installed = `~/.claude/plugins/installed_plugins.json` `{ version, plugins: { "<name>@<mkt>": [{ scope, projectPath?, installPath, version, installedAt }] } }`; enabled = `enabledPlugins: { "<name>@<mkt>": true|false }` in settings; manifest `<installPath>/.claude-plugin/plugin.json`.
- Memory: `~/.claude/CLAUDE.md`, `<ws>/CLAUDE.md`, `<ws>/.claude/CLAUDE.md`, `<ws>/CLAUDE.local.md`, `@path` imports; auto memory `~/.claude/projects/<slug>/memory/` (`MEMORY.md` index, first 200 lines / 25 KB loaded), `autoMemoryEnabled`, `autoMemoryDirectory`.
- `~/.claude.json` is rewritten by Claude constantly: SafeWriter conflict → re-plan once automatically, then tell the person.

## Global Constraints
- **Never send secret values to the webview**: MCP `env`/`headers` values, settings `env` values → keys only.
- All writes via SafeWriter with a confirmation (modal summary + "Show diff") and an Undo toast; managed and plugin files are read-only.
- Only official keys (schema bundled at build time from schemastore; unknown keys are reported, never written by Orbit).
- Everything else from stages 1–2 (no network, no shell, Windows paths, symlinks refused, bounded reads).

## Review Focus
1. Hostile/odd config: invalid JSON, JSONC comments, huge files, non-object values where objects expected, duplicate names across scopes → readers never throw, report the problem.
2. Secrets never leave the host (MCP env/headers, settings env).
3. `~/.claude.json` concurrent writes by Claude during an Orbit edit → conflict handled, nothing lost.
4. Windows paths in `projects[<path>]` keys (case, slashes) matched to the open workspace.
5. Plugin files are never edited; managed settings never edited.

---
### Task 1 (subagent A): config readers — `src/features/setup/`
```ts
export type SettingsScope = "user" | "project" | "local" | "managed";
export interface SettingsFile { scope: SettingsScope; path: string; exists: boolean; data: Record<string, unknown> | null; error: string | null }
export function managedSettingsPath(platform: NodeJS.Platform): string
export async function readSettingsFiles(home: string, workspace: string | null, platform?: NodeJS.Platform): Promise<SettingsFile[]>   // settings.ts

export interface InstalledPlugin { id: string; name: string; marketplace: string; scope: "user" | "project" | "local"; projectPath: string | null; installPath: string; version: string; description: string | null;
  enabled: boolean; enabledIn: SettingsScope[]; counts: { skills: number; agents: number; commands: number; hooks: number; mcpServers: number }; problem: string | null }
export async function readPlugins(home: string, settings: SettingsFile[], workspace: string | null, platform?: NodeJS.Platform): Promise<InstalledPlugin[]>   // plugins.ts — only entries relevant here (user scope, or project/local whose projectPath matches workspace); `enabled` = effective value by precedence; also returns ids enabled in settings but not installed with problem "Enabled but not installed" (installPath "")

export type McpScope = "user" | "local" | "project" | "plugin";
export interface McpServer { name: string; scope: McpScope; source: string; plugin: string | null; transport: "stdio" | "http" | "sse" | "ws" | "unknown";
  command: string | null; args: string[]; url: string | null; envKeys: string[]; headerKeys: string[]; approval: "approved" | "rejected" | "pending" | null; problem: string | null }
export async function readMcpServers(opts: { home: string; claudeJson: string; workspace: string | null; settings: SettingsFile[]; plugins: InstalledPlugin[]; platform?: NodeJS.Platform }): Promise<McpServer[]>   // mcp.ts — values of env/headers are NEVER copied; project approval from merged enabled/disabledMcpjsonServers/enableAllProjectMcpServers; `projects` key matched with samePath

export interface HookEntry { id: string; scope: SettingsScope | "plugin"; source: string; plugin: string | null; event: string; matcher: string | null; group: number; index: number;
  type: string; command: string | null; url: string | null; timeout: number | null }
export function readHooks(settings: SettingsFile[], pluginHooks: { plugin: string; source: string; data: unknown }[]): HookEntry[]   // hooks.ts (pure) + async readPluginHooks(plugins) returning pluginHooks from <installPath>/hooks/hooks.json
export interface PermissionRule { scope: SettingsScope; list: "allow" | "ask" | "deny"; rule: string }
export interface Permissions { rules: PermissionRule[]; defaultMode: { scope: SettingsScope; mode: string }[]; additionalDirectories: { scope: SettingsScope; dir: string }[] }
export function readPermissions(settings: SettingsFile[]): Permissions   // permissions.ts (pure)
```
Tests (fixtures with realistic files): every scope, JSONC/invalid JSON → `error` set, non-object values tolerated, secrets absent from output (assert JSON.stringify(result) has no secret value), Windows project key matching (`c:\\Code\\App` vs `C:\\code\\app`), plugin scope filtering, enabled precedence (local false overrides user true), not-installed plugin, plugin component counts, hooks of all types, malformed hooks skipped, permissions merge.

### Task 2 (subagent B): content readers — `src/features/setup/`
```ts
export interface Frontmatter { data: Record<string, unknown>; body: string; error: string | null }
export function parseFrontmatter(text: string): Frontmatter   // frontmatter.ts — uses the `yaml` package; no frontmatter → data {} body = text; bad YAML → error
export type ContentScope = "user" | "project" | "plugin";
export interface SkillInfo { name: string; description: string | null; scope: ContentScope; plugin: string | null; dir: string; file: string; model: string | null; allowedTools: string[]; userInvocable: boolean; modelInvocable: boolean; problems: string[] }
export interface CommandInfo { name: string; description: string | null; argumentHint: string | null; scope: ContentScope; plugin: string | null; file: string; problems: string[] }
export interface AgentInfo { name: string; description: string | null; tools: string[]; model: string | null; scope: ContentScope; plugin: string | null; file: string; problems: string[] }
export interface PluginRoot { id: string; installPath: string }
export async function readSkills(home: string, workspace: string | null, plugins: PluginRoot[]): Promise<SkillInfo[]>
export async function readCommands(home: string, workspace: string | null, plugins: PluginRoot[]): Promise<CommandInfo[]>
export async function readAgents(home: string, workspace: string | null, plugins: PluginRoot[]): Promise<AgentInfo[]>
export interface ClaudeMdFile { scope: "user" | "project" | "project-dir" | "local" | "managed"; path: string; exists: boolean; bytes: number; imports: { ref: string; path: string; exists: boolean }[] }
export interface MemoryFile { name: string; path: string; bytes: number; title: string | null; description: string | null; links: string[]; brokenLinks: string[]; orphan: boolean }
export interface MemoryInfo { claudeMd: ClaudeMdFile[]; auto: { enabled: boolean; dir: string; indexPath: string | null; indexLines: number; indexBytes: number; files: MemoryFile[] } }
export async function readMemory(opts: { home: string; workspace: string | null; settings: { autoMemoryEnabled?: unknown; autoMemoryDirectory?: unknown }; platform?: NodeJS.Platform }): Promise<MemoryInfo>
```
Problems to detect: skill/agent missing `description`, skill `name` ≠ folder, frontmatter YAML error, agent `model` not in {sonnet, opus, haiku, fable, inherit} and not a `claude-…` id, command file empty. Memory: `[[link]]` targets matched to memory `name` frontmatter or file stem; orphan = not linked from MEMORY.md nor any other memory file; auto memory dir = `autoMemoryDirectory` or `projects/<slug of workspace>/memory` (slug: non-alphanumerics → `-`). All reads via fsSafe (no symlinks, size caps 256 KB per file), readers never throw.

### Task 3: health checks (pure) — `src/features/setup/health.ts`
### Task 4: setup service + edits (SafeWriter plans, confirmation + diff preview, undo toast, `~/.claude.json` conflict retry) — `src/extension/setupService.ts`, `setupActions.ts`
### Task 5: Setup tab UI (sections: Health, MCP, Plugins, Skills, Agents, Commands, Hooks, Permissions, Memory, Settings (schema-driven), Recent changes with Undo)
### Task 6: stage review + fixes
