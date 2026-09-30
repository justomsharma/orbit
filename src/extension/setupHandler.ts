import * as path from "node:path";
import { applyJsonEdit, applyTextEdit, type ConfirmHost } from "../core/applyEdit";
import type { SafeWriter } from "../core/safeWriter";
import { settingsCatalog } from "../features/setup/catalog";
import {
  addHook,
  addMcpServer,
  addPermissionRule,
  EditError,
  type Mutate,
  removeHook,
  removeMcpServer,
  removePermissionRule,
  setMcpApproval,
  setPluginEnabled,
  setSetting,
  setSkillVisibility,
} from "../features/setup/edits";
import { HOOK_EVENTS, humanize } from "../features/setup/hookEvents";
import { newItem } from "../features/setup/templates";
import { parseViewMsg, type ViewMsg } from "../shared/protocol";
import type { SetupSnapshot } from "./setupService";

export interface SetupHandlerDeps {
  home: string;
  claudeJson: string;
  workspace(): string | null;
  platform: NodeJS.Platform;
  writer: SafeWriter;
  confirm: ConfirmHost;
  /** The snapshot the view is showing; ids and files are checked against it. */
  snapshot(): SetupSnapshot | null;
  refresh(): Promise<void>;
  openFile(file: string): Promise<void>;
  /** Runs `claude <args>` as a terminal's own program (no shell). */
  runClaude(args: string[], cwd?: string): Promise<void>;
  /** Opens Claude's chat with a prompt typed in (not sent). */
  newChat(prompt: string): Promise<void>;
}

type EditScope = "user" | "project" | "local";
const SCOPE_WORD: Record<EditScope, string> = {
  user: "user",
  project: "shared project",
  local: "local project",
};
const MODES = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];

const CLAUDE_MD_TEMPLATE = `# Notes for Claude

Describe this project in a few lines: what it is, how to run and test it, and any
conventions Claude should follow.

## Commands
- Test: …
- Build: …
`;

type SetupMsg = Extract<ViewMsg, { type: `setup:${string}` }>;

/** Handles one Setup message. Returns false for messages that belong elsewhere. */
export async function handleSetup(raw: unknown, d: SetupHandlerDeps): Promise<boolean> {
  const m = parseViewMsg(raw);
  if (!m || !m.type.startsWith("setup:")) return false;
  const msg = m as SetupMsg;
  const warn = (text: string) => d.confirm.warn(text);
  const ws = d.workspace();

  const settingsPath = (scope: EditScope): string | null => {
    if (scope === "user") return path.join(d.home, "settings.json");
    if (!ws) return null;
    return path.join(ws, ".claude", scope === "project" ? "settings.json" : "settings.local.json");
  };

  const edit = async (file: string | null, mutate: Mutate, summary: string, label: string) => {
    if (!file) {
      warn("Open a folder first: project settings belong to a folder.");
      return;
    }
    if (await applyJsonEdit(d.writer, d.confirm, { file, mutate, summary, label }))
      await d.refresh();
  };

  switch (msg.type) {
    case "setup:refresh":
      await d.refresh();
      return true;

    case "setup:setSetting": {
      const where = SCOPE_WORD[msg.scope];
      const label = humanize(msg.key);
      if (msg.key === "permissions.defaultMode") {
        if (msg.value !== null && !MODES.includes(String(msg.value))) {
          warn(`"${msg.value}" isn't one of Claude Code's permission modes.`);
          return true;
        }
      } else {
        const def = settingsCatalog().find((s) => s.key === msg.key);
        if (!def) {
          warn(`"${msg.key}" isn't a Claude Code setting, so Orbit won't write it.`);
          return true;
        }
        if (def.managedOnly) {
          warn(`"${label}" only works in your organisation's managed settings.`);
          return true;
        }
        if (msg.value !== null) {
          const v = msg.value;
          const ok =
            def.kind === "boolean"
              ? typeof v === "boolean"
              : def.kind === "number"
                ? typeof v === "number" && (def.minimum === undefined || v >= def.minimum)
                : def.kind === "enum"
                  ? typeof v === "string" && (def.enum ?? []).includes(v)
                  : def.kind === "string"
                    ? typeof v === "string"
                    : false;
          if (!ok) {
            warn(
              def.kind === "boolean"
                ? `"${label}" is an on or off setting.`
                : def.kind === "enum"
                  ? `"${v}" isn't one of the options for "${label}": ${(def.enum ?? []).join(", ")}.`
                  : `"${label}" needs a ${def.kind === "json" ? "value Orbit can't edit here" : def.kind}.`,
            );
            return true;
          }
        }
      }
      const summary =
        msg.value === null
          ? `Reset "${label}" to Claude's default in your ${where} settings?`
          : `Set "${label}" to "${msg.value}" in your ${where} settings?`;
      await edit(
        settingsPath(msg.scope),
        setSetting(msg.key, msg.value ?? undefined),
        summary,
        `${label}: ${msg.value ?? "default"}`,
      );
      return true;
    }

    case "setup:plugin":
      await edit(
        settingsPath(msg.scope),
        setPluginEnabled(msg.id, msg.enabled),
        `Turn ${msg.enabled ? "on" : "off"} the plugin "${msg.id}" in your ${SCOPE_WORD[msg.scope]} settings?`,
        `Plugin ${msg.id} ${msg.enabled ? "on" : "off"}`,
      );
      return true;

    case "setup:mcpApproval":
      await edit(
        settingsPath("local"),
        setMcpApproval(msg.name, msg.state),
        `${msg.state === "approved" ? "Approve" : "Reject"} the project MCP server "${msg.name}" for you in this folder?`,
        `MCP ${msg.name} ${msg.state}`,
      );
      return true;

    case "setup:mcpRemove": {
      const file =
        msg.scope === "project" ? (ws ? path.join(ws, ".mcp.json") : null) : d.claudeJson;
      await edit(
        file,
        removeMcpServer({
          scope: msg.scope,
          name: msg.name,
          workspace: ws ?? undefined,
          platform: d.platform,
        }),
        `Remove the MCP server "${msg.name}"? You can undo this.`,
        `Removed MCP ${msg.name}`,
      );
      return true;
    }

    case "setup:mcpAdd": {
      const server: Record<string, unknown> =
        msg.transport === "stdio"
          ? { type: "stdio", command: msg.command, ...(msg.args?.length ? { args: msg.args } : {}) }
          : { type: msg.transport, url: msg.url };
      if ((msg.transport === "stdio" && !msg.command) || (msg.transport !== "stdio" && !msg.url)) {
        warn(
          msg.transport === "stdio"
            ? "Enter the command that starts the server."
            : "Enter the server's URL.",
        );
        return true;
      }
      const file =
        msg.scope === "project" ? (ws ? path.join(ws, ".mcp.json") : null) : d.claudeJson;
      const where =
        msg.scope === "project"
          ? "this project's .mcp.json"
          : msg.scope === "local"
            ? "this folder (just you)"
            : "all your projects";
      await edit(
        file,
        addMcpServer({
          scope: msg.scope,
          name: msg.name,
          server,
          workspace: ws ?? undefined,
          platform: d.platform,
        }),
        `Add the MCP server "${msg.name}" for ${where}?`,
        `Added MCP ${msg.name}`,
      );
      return true;
    }

    case "setup:mcpLogin":
      await d.runClaude(["mcp", "login", msg.name], ws ?? undefined);
      return true;

    case "setup:hookRemove": {
      const h = d.snapshot()?.hooks.find((x) => x.id === msg.id);
      if (!h || h.plugin || h.scope === "managed" || h.scope === "plugin") {
        warn("That hook can't be removed here (it belongs to a plugin or your organisation).");
        return true;
      }
      await edit(
        h.source,
        removeHook({ event: h.event, group: h.group, index: h.index, command: h.command }),
        `Remove this ${h.event} hook${h.command ? `: ${h.command}` : ""}? You can undo this.`,
        `Removed ${h.event} hook`,
      );
      return true;
    }

    case "setup:hookAdd":
      if (!(HOOK_EVENTS as readonly string[]).includes(msg.event)) {
        warn(`"${msg.event}" isn't a Claude Code hook event.`);
        return true;
      }
      await edit(
        settingsPath(msg.scope),
        addHook({
          event: msg.event,
          matcher: msg.matcher?.trim() || null,
          command: msg.command,
          timeout: msg.timeout,
        }),
        `Add a ${msg.event} hook that runs "${msg.command}" in your ${SCOPE_WORD[msg.scope]} settings?`,
        `Added ${msg.event} hook`,
      );
      return true;

    case "setup:hooksPaused":
      await edit(
        settingsPath("user"),
        setSetting("disableAllHooks", msg.paused ? true : undefined),
        msg.paused
          ? "Pause all hooks (and the statusline) until you turn them back on?"
          : "Turn hooks back on?",
        msg.paused ? "Hooks paused" : "Hooks on",
      );
      return true;

    case "setup:rule":
      await edit(
        settingsPath(msg.scope),
        msg.op === "add"
          ? addPermissionRule(msg.list, msg.rule)
          : removePermissionRule(msg.list, msg.rule),
        `${msg.op === "add" ? "Add" : "Remove"} the ${msg.list} rule "${msg.rule}" ${msg.op === "add" ? "to" : "from"} your ${SCOPE_WORD[msg.scope]} settings?`,
        `${msg.op === "add" ? "Added" : "Removed"} ${msg.list} rule`,
      );
      return true;

    case "setup:skillVisibility": {
      const word = { on: "Show", "name-only": "Show only the name of", off: "Hide" }[
        msg.visibility
      ];
      await edit(
        settingsPath("user"),
        setSkillVisibility(msg.name, msg.visibility),
        `${word} the skill "${msg.name}" ${msg.visibility === "off" ? "from" : "to"} Claude?`,
        `Skill ${msg.name}: ${msg.visibility}`,
      );
      return true;
    }

    case "setup:new": {
      const root = msg.scope === "user" ? d.home : ws ? path.join(ws, ".claude") : null;
      if (!root) {
        warn("Open a folder first to add something to this project.");
        return true;
      }
      let item: { file: string; text: string };
      try {
        item = newItem({ kind: msg.kind, root, name: msg.name, description: msg.description });
      } catch (e) {
        warn(e instanceof Error ? e.message : String(e));
        return true;
      }
      const created = await applyTextEdit(d.writer, d.confirm, {
        file: item.file,
        transform: (before) => {
          if (before !== null)
            throw new EditError(`A ${msg.kind} named "${msg.name}" already exists.`);
          return item.text;
        },
        summary: `Create the ${msg.kind} "${msg.name}" ${msg.scope === "user" ? "for all your projects" : "in this project"}?`,
        label: `New ${msg.kind} ${msg.name}`,
      });
      if (created) {
        await d.openFile(item.file);
        await d.refresh();
      }
      return true;
    }

    case "setup:createClaudeMd": {
      const file =
        msg.scope === "user"
          ? path.join(d.home, "CLAUDE.md")
          : ws
            ? path.join(ws, msg.scope === "project" ? "CLAUDE.md" : "CLAUDE.local.md")
            : null;
      if (!file) {
        warn("Open a folder first to add project instructions.");
        return true;
      }
      const created = await applyTextEdit(d.writer, d.confirm, {
        file,
        transform: (before) => {
          if (before !== null) throw new EditError(`${path.basename(file)} already exists.`);
          return CLAUDE_MD_TEMPLATE;
        },
        summary: `Create ${path.basename(file)} ${msg.scope === "user" ? "for all your projects" : "in this project"}?`,
        label: `New ${path.basename(file)}`,
      });
      if (created) {
        await d.openFile(file);
        await d.refresh();
      }
      return true;
    }

    case "setup:open": {
      if (!knownFiles(d.snapshot()).has(norm(msg.file, d.platform))) return true;
      await d.openFile(msg.file);
      return true;
    }

    case "setup:fixWithClaude": {
      const issue = d.snapshot()?.issues.find((i) => i.id === msg.issueId);
      if (issue?.claudePrompt) await d.newChat(issue.claudePrompt);
      return true;
    }
  }
  return true;
}

const norm = (p: string, platform: NodeJS.Platform) =>
  platform === "win32" ? path.win32.normalize(p).toLowerCase() : path.posix.normalize(p);

/** Files the Setup tab showed; only these can be opened from the view. */
function knownFiles(s: SetupSnapshot | null): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  const platform = process.platform;
  const add = (p: string | null | undefined) => {
    if (p) out.add(norm(p, platform));
  };
  for (const f of s.settings) if (f.exists) add(f.path);
  add(s.claudeJsonPath);
  for (const m of s.mcp) if (!m.plugin) add(m.source);
  for (const h of s.hooks) if (!h.plugin) add(h.source);
  for (const x of [...s.skills, ...s.agents, ...s.commands]) add(x.file);
  for (const c of s.memory.claudeMd) if (c.exists) add(c.path);
  for (const f of s.memory.auto.files) add(f.path);
  add(s.memory.auto.indexPath);
  for (const i of s.issues) add(i.file);
  return out;
}
