import { join } from "node:path";
import { readTextSafe } from "../../core/fsSafe";
import { type Frontmatter, parseFrontmatter } from "./frontmatter";

/** Where a skill, command or agent comes from. */
export type ContentScope = "user" | "project" | "plugin";

/** An installed plugin's folder; `id` is `<name>@<marketplace>`. */
export interface PluginRoot {
  id: string;
  installPath: string;
}

/** A folder to scan, tagged with where its items come from. */
export interface ContentRoot {
  dir: string;
  scope: ContentScope;
  plugin: string | null;
}

export const MAX_FILE_BYTES = 256 * 1024;
export const PARALLEL = 16;
export const UNREADABLE = "Could not read this file";
export const NO_DESCRIPTION = "No description — Claude won't know when to use it";

/** Plugin name without its marketplace: `tools@market` → `tools`. */
export const pluginName = (id: string) => id.split("@")[0] || id;

/** The `sub` folder of the user's Claude home, the workspace's `.claude`, and each plugin. */
export function contentRoots(
  home: string,
  workspace: string | null,
  plugins: PluginRoot[],
  sub: string,
): ContentRoot[] {
  const roots: ContentRoot[] = [{ dir: join(home, sub), scope: "user", plugin: null }];
  if (workspace)
    roots.push({ dir: join(workspace, ".claude", sub), scope: "project", plugin: null });
  for (const p of plugins)
    if (p.installPath) roots.push({ dir: join(p.installPath, sub), scope: "plugin", plugin: p.id });
  return roots;
}

/** Reads and splits a Markdown file; `null` when it is missing, a link, or over the size cap. */
export async function readMarkdown(file: string): Promise<(Frontmatter & { text: string }) | null> {
  const text = await readTextSafe(file, MAX_FILE_BYTES);
  return text === null ? null : { ...parseFrontmatter(text), text };
}

export const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Tool lists as written in frontmatter: a YAML list, or a string separated by
 * commas or spaces. Spaces inside parentheses stay, e.g. `Bash(git add *)`.
 */
export function toolList(v: unknown): string[] {
  if (Array.isArray(v))
    return v.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim());
  if (typeof v !== "string") return [];
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of v) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || /\s/.test(ch))) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const SCOPE_ORDER: Record<ContentScope, number> = { project: 0, user: 1, plugin: 2 };

/** Project first, then user, then plugin; by name within each. */
export function byScopeThenName<T extends { scope: ContentScope; name: string }>(a: T, b: T) {
  return SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.name.localeCompare(b.name);
}
