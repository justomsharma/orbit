import { join } from "node:path";
import { mapLimit } from "../../core/concurrency";
import { listDirSafe } from "../../core/fsSafe";
import {
  byScopeThenName,
  type ContentRoot,
  type ContentScope,
  contentRoots,
  PARALLEL,
  type PluginRoot,
  pluginName,
  readMarkdown,
  strOrNull,
  UNREADABLE,
} from "./content";

export interface CommandInfo {
  name: string;
  description: string | null;
  argumentHint: string | null;
  scope: ContentScope;
  plugin: string | null;
  file: string;
  problems: string[];
}

/** Folder levels below a commands root that are still scanned. */
const MAX_DEPTH = 4;
const MAX_DESCRIPTION = 120;

interface Found extends ContentRoot {
  file: string;
  /** Path parts below the root, the last one without `.md`. */
  parts: string[];
}

/** `*.md` files under `dir`, recursively. Linked files and folders are not followed. */
async function walk(root: ContentRoot, dir: string, parts: string[], out: Found[]) {
  for (const e of await listDirSafe(dir)) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().endsWith(".md"))
      out.push({ ...root, file: p, parts: [...parts, e.name.slice(0, -3)] });
    else if (e.isDirectory() && parts.length < MAX_DEPTH)
      await walk(root, p, [...parts, e.name], out);
  }
}

/** First non-empty line of the body, used when there is no `description`. */
function firstLine(body: string): string | null {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  return line.length > MAX_DESCRIPTION ? `${line.slice(0, MAX_DESCRIPTION - 1)}…` : line;
}

/** `argument-hint: [file]` is a YAML list; show it the way it was written. */
function hintText(v: unknown): string | null {
  if (Array.isArray(v)) {
    const parts = v.filter((x) => typeof x === "string" || typeof x === "number");
    return parts.length ? parts.map((x) => `[${x}]`).join(" ") : null;
  }
  return strOrNull(v);
}

async function readCommand(f: Found): Promise<CommandInfo> {
  const local = f.parts.join(":");
  const name = f.plugin ? `${pluginName(f.plugin)}:${local}` : local;
  const base = { name, scope: f.scope, plugin: f.plugin, file: f.file };
  const md = await readMarkdown(f.file);
  if (!md) return { ...base, description: null, argumentHint: null, problems: [UNREADABLE] };
  const problems: string[] = [];
  if (md.error) problems.push(md.error);
  if (!md.text.trim()) problems.push("Empty command");
  return {
    ...base,
    description: strOrNull(md.data.description) ?? firstLine(md.body),
    argumentHint: hintText(md.data["argument-hint"]),
    problems,
  };
}

/** Slash commands from `~/.claude/commands`, the workspace's `.claude/commands` and each plugin. */
export async function readCommands(
  home: string,
  workspace: string | null,
  plugins: PluginRoot[],
): Promise<CommandInfo[]> {
  const found: Found[] = [];
  for (const root of contentRoots(home, workspace, plugins, "commands"))
    await walk(root, root.dir, [], found);
  const cmds = await mapLimit(found, PARALLEL, (f) => readCommand(f).catch(() => null));
  return cmds.filter((c): c is CommandInfo => c !== null).sort(byScopeThenName);
}
