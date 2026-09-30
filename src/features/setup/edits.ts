/**
 * Every change Orbit can make to Claude Code's setup, as a pure function that
 * edits a parsed JSON object. SafeWriter.planJson applies them with preview,
 * backup and undo. Each one refuses (EditError) rather than guessing when the
 * file doesn't look the way it was shown.
 */

import type { Mutate } from "../../core/applyEdit";
import { claudeProjectKey, findProjectKey } from "../../core/paths";

export type { Mutate };

type Obj = Record<string, unknown>;

export class EditError extends Error {}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The object at `o[key]`, created when missing; refuses to replace a non-object. */
function child(o: Obj, key: string): Obj {
  const v = o[key];
  if (v === undefined) {
    const made: Obj = {};
    o[key] = made;
    return made;
  }
  if (!isObj(v))
    throw new EditError(`"${key}" isn't an object in this file, so Orbit won't change it.`);
  return v;
}

function list(o: Obj, key: string): unknown[] {
  const v = o[key];
  if (v === undefined) {
    const made: unknown[] = [];
    o[key] = made;
    return made;
  }
  if (!Array.isArray(v))
    throw new EditError(`"${key}" isn't a list in this file, so Orbit won't change it.`);
  return v;
}

/** Sets (or with `undefined`, removes) a setting. Dotted keys reach one level in, e.g. `permissions.defaultMode`. */
export function setSetting(key: string, value: unknown): Mutate {
  return (o) => {
    const parts = key.split(".");
    let target = o;
    for (const p of parts.slice(0, -1)) target = child(target, p);
    const last = parts[parts.length - 1]!;
    if (value === undefined) delete target[last];
    else target[last] = value;
  };
}

export function setPluginEnabled(id: string, enabled: boolean): Mutate {
  return (o) => {
    child(o, "enabledPlugins")[id] = enabled;
  };
}

/** Approve or reject a server from the project's `.mcp.json` (Claude Code's own approval lists). */
export function setMcpApproval(name: string, state: "approved" | "rejected"): Mutate {
  return (o) => {
    const on = list(o, "enabledMcpjsonServers");
    const off = list(o, "disabledMcpjsonServers");
    const add = state === "approved" ? on : off;
    const drop = state === "approved" ? off : on;
    for (let i = drop.length - 1; i >= 0; i--) if (drop[i] === name) drop.splice(i, 1);
    if (!add.includes(name)) add.push(name);
  };
}

const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

interface McpTarget {
  scope: "user" | "local" | "project";
  name: string;
  workspace?: string;
  platform?: NodeJS.Platform;
}

/** The `mcpServers` object for a scope: `~/.claude.json` (user, local) or `.mcp.json` (project). */
function serversFor(o: Obj, t: McpTarget, create: boolean): Obj | null {
  if (t.scope === "user" || t.scope === "project")
    return create ? child(o, "mcpServers") : isObj(o.mcpServers) ? o.mcpServers : null;
  if (!t.workspace) throw new EditError("No folder is open for a local MCP server.");
  const projects = create ? child(o, "projects") : isObj(o.projects) ? o.projects : null;
  if (!projects) return null;
  const key =
    findProjectKey(Object.keys(projects), t.workspace, t.platform) ??
    (create ? claudeProjectKey(t.workspace, t.platform) : null);
  if (!key) return null;
  const entry = create
    ? child(projects, key)
    : isObj(projects[key])
      ? (projects[key] as Obj)
      : null;
  if (!entry) return null;
  return create ? child(entry, "mcpServers") : isObj(entry.mcpServers) ? entry.mcpServers : null;
}

export function addMcpServer(t: McpTarget & { server: Obj }): Mutate {
  return (o) => {
    if (!MCP_NAME.test(t.name)) {
      throw new EditError("Use letters, numbers, dots, dashes or underscores for the server name.");
    }
    const servers = serversFor(o, t, true)!;
    if (Object.hasOwn(servers, t.name))
      throw new EditError(`A server named "${t.name}" already exists here.`);
    servers[t.name] = t.server;
  };
}

export function removeMcpServer(t: McpTarget): Mutate {
  return (o) => {
    const servers = serversFor(o, t, false);
    if (!servers || !Object.hasOwn(servers, t.name)) {
      throw new EditError(`"${t.name}" is no longer in this file. Refresh and try again.`);
    }
    delete servers[t.name];
  };
}

interface HookRef {
  event: string;
  group: number;
  index: number;
  /** What the person saw; the edit refuses if the handler there is different now. */
  command: string | null;
}

export function removeHook(h: HookRef): Mutate {
  return (o) => {
    const hooks = child(o, "hooks");
    const groups = hooks[h.event];
    const group = Array.isArray(groups) ? groups[h.group] : undefined;
    const handlers = isObj(group) && Array.isArray(group.hooks) ? group.hooks : undefined;
    const handler = handlers?.[h.index];
    const command = isObj(handler) && typeof handler.command === "string" ? handler.command : null;
    if (!handlers || !isObj(handler) || command !== h.command) {
      throw new EditError("This hook changed since Orbit showed it. Refresh and try again.");
    }
    handlers.splice(h.index, 1);
    if (handlers.length === 0) (groups as unknown[]).splice(h.group, 1);
    if ((groups as unknown[]).length === 0) delete hooks[h.event];
    if (Object.keys(hooks).length === 0) delete o.hooks;
  };
}

export function addHook(h: {
  event: string;
  matcher: string | null;
  command: string;
  timeout?: number;
}): Mutate {
  return (o) => {
    if (!h.command.trim()) throw new EditError("Enter the command the hook should run.");
    const groups = list(child(o, "hooks"), h.event);
    const handler: Obj = { type: "command", command: h.command };
    if (h.timeout) handler.timeout = h.timeout;
    const same = groups.find(
      (g) => isObj(g) && (g.matcher ?? null) === h.matcher && Array.isArray(g.hooks),
    );
    if (same) (same as { hooks: unknown[] }).hooks.push(handler);
    else groups.push(h.matcher ? { matcher: h.matcher, hooks: [handler] } : { hooks: [handler] });
  };
}

export type RuleList = "allow" | "ask" | "deny";

export function addPermissionRule(which: RuleList, rule: string): Mutate {
  return (o) => {
    const r = rule.trim();
    if (!r) throw new EditError("Enter a rule, for example Bash(npm test).");
    const rules = list(child(o, "permissions"), which);
    if (!rules.includes(r)) rules.push(r);
  };
}

export function removePermissionRule(which: RuleList, rule: string): Mutate {
  return (o) => {
    const rules = list(child(o, "permissions"), which);
    const i = rules.indexOf(rule);
    if (i === -1)
      throw new EditError(`"${rule}" is no longer in this file. Refresh and try again.`);
    rules.splice(i, 1);
  };
}

export type SkillVisibility = "on" | "name-only" | "off";

/** Claude Code's `skillOverrides`; "on" is the default, so it removes the override. */
export function setSkillVisibility(name: string, v: SkillVisibility): Mutate {
  return (o) => {
    const overrides = child(o, "skillOverrides");
    if (v === "on") delete overrides[name];
    else overrides[name] = v;
  };
}
