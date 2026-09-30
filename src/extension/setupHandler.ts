import * as path from "node:path";
import { applyJsonEdit, applyTextEdit, type ConfirmHost } from "../core/applyEdit";
import type { SafeWriter } from "../core/safeWriter";
import { settingsCatalog } from "../features/setup/catalog";
import {
  addHook,
  addMcpServer,
  addPermissionRule,
  dropMcpRejection,
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
import { redactText } from "../features/setup/redact";
import { MODE_LABELS, riskWarning } from "../features/setup/risk";
import { decidingScope, readSettingsFiles, toggleScope } from "../features/setup/settings";
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
  if (!m?.type.startsWith("setup:")) return false;
  const msg = m as SetupMsg;
  const warn = (text: string) => d.confirm.warn(text);
  const ws = d.workspace();

  const settingsPath = (scope: EditScope): string | null => {
    if (scope === "user") return path.join(d.home, "settings.json");
    if (!ws) return null;
    return path.join(ws, ".claude", scope === "project" ? "settings.json" : "settings.local.json");
  };

  const edit = async (
    file: string | null,
    mutate: Mutate,
    summary: string,
    label: string,
    warning?: string,
  ) => {
    if (!file) {
      warn("Open a folder first: project settings belong to a folder.");
      return;
    }
    const ok = await applyJsonEdit(d.writer, d.confirm, { file, mutate, summary, label, warning });
    if (ok) await d.refresh();
    return ok;
  };

  /**
   * Where a toggle must write to take effect (see toggleScope), and whether another
   * file also sets it — then "off" is written out instead of just removing the key.
   * Null (after saying why) when the organisation's managed settings decide it.
   */
  const toggleTarget = async (
    keyPath: string[],
    label: string,
  ): Promise<{ scope: EditScope; elsewhere: boolean } | null> => {
    const files = await readSettingsFiles(d.home, ws, d.platform);
    const scope = toggleScope(files, keyPath);
    if (scope === "managed") {
      warn(`Your organisation's managed settings decide "${label}", so it can't be changed here.`);
      return null;
    }
    const others = files.filter((f) => f.scope !== scope);
    return { scope, elsewhere: decidingScope(others, keyPath) !== null };
  };

  switch (msg.type) {
    case "setup:refresh":
      await d.refresh();
      return true;

    case "setup:setSetting": {
      const label = humanize(msg.key);
      let scope: EditScope;
      if (msg.scope === "auto") {
        const t = await toggleTarget(msg.key.split("."), label);
        if (!t) return true;
        scope = t.scope;
      } else scope = msg.scope;
      const where = SCOPE_WORD[scope];
      if (msg.key === "permissions.defaultMode") {
        if (msg.value !== null && !(String(msg.value) in MODE_LABELS)) {
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
      const shownValue =
        msg.key === "permissions.defaultMode" && msg.value !== null
          ? (MODE_LABELS[String(msg.value)] ?? msg.value)
          : msg.value;
      const summary =
        msg.value === null
          ? `Reset "${label}" to Claude's default in your ${where} settings?`
          : `Set "${label}" to "${shownValue}" in your ${where} settings?`;
      await edit(
        settingsPath(scope),
        setSetting(msg.key, msg.value ?? undefined),
        summary,
        `${label}: ${shownValue ?? "default"}`,
        riskWarning(msg.key, msg.value, scope) ?? undefined,
      );
      return true;
    }

    case "setup:plugin": {
      let scope: EditScope;
      if (msg.scope === "auto") {
        const t = await toggleTarget(["enabledPlugins", msg.id], `the plugin ${msg.id}`);
        if (!t) return true;
        scope = t.scope;
      } else scope = msg.scope;
      await edit(
        settingsPath(scope),
        setPluginEnabled(msg.id, msg.enabled),
        `Turn ${msg.enabled ? "on" : "off"} the plugin "${msg.id}" in your ${SCOPE_WORD[scope]} settings?`,
        `Plugin ${msg.id} ${msg.enabled ? "on" : "off"}`,
      );
      return true;
    }

    case "setup:mcpApproval": {
      if (msg.state === "rejected") {
        await edit(
          settingsPath("local"),
          setMcpApproval(msg.name, msg.state),
          `Stop using the project MCP server "${msg.name}" for you in this folder?`,
          `MCP ${msg.name} rejected`,
        );
        return true;
      }
      // A rejection in any settings file wins, so approving lifts each one it finds.
      const files = await readSettingsFiles(d.home, ws, d.platform);
      const rejectedIn = (scope: string) => {
        const list = files.find((f) => f.scope === scope)?.data?.disabledMcpjsonServers;
        return Array.isArray(list) && list.includes(msg.name);
      };
      if (rejectedIn("managed")) {
        warn(
          `Your organisation's managed settings block "${msg.name}", so it can't be approved here.`,
        );
        return true;
      }
      const approved = await edit(
        settingsPath("local"),
        setMcpApproval(msg.name, "approved"),
        `Approve the project MCP server "${msg.name}" for you in this folder?`,
        `MCP ${msg.name} approved`,
      );
      if (!approved) return true;
      if (rejectedIn("user"))
        await edit(
          settingsPath("user"),
          dropMcpRejection(msg.name),
          `Your user settings also reject "${msg.name}" in every project. Remove that rejection too?`,
          `MCP ${msg.name}: user rejection removed`,
        );
      if (rejectedIn("project"))
        await edit(
          settingsPath("project"),
          dropMcpRejection(msg.name),
          `The shared project settings (.claude/settings.json) reject "${msg.name}". Remove that rejection? This changes it for everyone using this repository.`,
          `MCP ${msg.name}: project rejection removed`,
        );
      return true;
    }

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
        `Remove this ${h.event} hook${h.command ? `: ${redactText(h.command)}` : ""}? You can undo this.`,
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

    case "setup:hooksPaused": {
      const t = await toggleTarget(["disableAllHooks"], "Pause all hooks");
      if (!t) return true;
      await edit(
        settingsPath(t.scope),
        setSetting("disableAllHooks", msg.paused ? true : t.elsewhere ? false : undefined),
        msg.paused
          ? "Pause all hooks (and the statusline) until you turn them back on?"
          : "Turn hooks back on?",
        msg.paused ? "Hooks paused" : "Hooks on",
      );
      return true;
    }

    case "setup:rule": {
      let rule = msg.rule;
      if (msg.op === "remove") {
        // The view shows rules with secrets masked; find the real rule it stands for.
        const real = new Set(
          (d.snapshot()?.permissions.rules ?? [])
            .filter((r) => r.scope === msg.scope && r.list === msg.list)
            .map((r) => r.rule)
            .filter((r) => r === msg.rule || redactText(r) === msg.rule),
        );
        if (real.size > 1) {
          warn("Several rules look the same once secrets are hidden. Remove this one in the file.");
          return true;
        }
        rule = [...real][0] ?? msg.rule;
      }
      await edit(
        settingsPath(msg.scope),
        msg.op === "add" ? addPermissionRule(msg.list, rule) : removePermissionRule(msg.list, rule),
        `${msg.op === "add" ? "Add" : "Remove"} the ${msg.list} rule "${redactText(rule)}" ${msg.op === "add" ? "to" : "from"} your ${SCOPE_WORD[msg.scope]} settings?`,
        `${msg.op === "add" ? "Added" : "Removed"} ${msg.list} rule`,
      );
      return true;
    }

    case "setup:skillVisibility": {
      const n = `"${msg.name}"`;
      const question = {
        on: `Show the skill ${n} to Claude?`,
        "name-only": `Show only the name of the skill ${n} to Claude?`,
        "user-invocable-only": `Keep the skill ${n} for when you type /${msg.name}, so Claude doesn't use it on its own?`,
        off: `Hide the skill ${n} from Claude?`,
      }[msg.visibility];
      const t = await toggleTarget(["skillOverrides", msg.name], `the skill ${msg.name}`);
      if (!t) return true;
      await edit(
        settingsPath(t.scope),
        setSkillVisibility(msg.name, msg.visibility, t.elsewhere),
        question,
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
      // The view saw ids with any secret masked (see viewSnapshot).
      const issue = d
        .snapshot()
        ?.issues.find((i) => i.id === msg.issueId || redactText(i.id) === msg.issueId);
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
