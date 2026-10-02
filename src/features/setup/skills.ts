import { stat } from "node:fs/promises";
import { join } from "node:path";
import { mapLimit } from "../../core/concurrency";
import { listDirSafe, statSafe } from "../../core/fsSafe";
import {
  byScopeThenName,
  type ContentRoot,
  type ContentScope,
  contentRoots,
  NO_DESCRIPTION,
  PARALLEL,
  type PluginRoot,
  pluginName,
  readMarkdown,
  strOrNull,
  toolList,
  UNREADABLE,
} from "./content";

export interface SkillInfo {
  name: string;
  description: string | null;
  scope: ContentScope;
  plugin: string | null;
  dir: string;
  file: string;
  model: string | null;
  allowedTools: string[];
  userInvocable: boolean;
  modelInvocable: boolean;
  problems: string[];
  /** The skill's folder is a link (symlink or junction) to somewhere else; Claude follows it. */
  linked: boolean;
  /** Labels from `tags` or `metadata.tags` (for finding skills; Claude doesn't use them). */
  tags: string[];
  argumentHint: string | null;
  /** Folders between `skills/` and this skill's folder, e.g. "team"; null when it sits right below. */
  group: string | null;
  /** Claude Code loads it (it sits one folder below `skills/`). */
  loaded: boolean;
  /** What you type to run it: `/name`, or `/plugin:name` for a plugin's skill. */
  command: string;
}

interface Found extends ContentRoot {
  folder: string;
  linked: boolean;
  /** Grouping folders above it, outermost first. */
  path: string[];
}

/** How deep grouping folders are searched for skills Claude won't load. */
const MAX_GROUP_DEPTH = 3;

/** `tags: a, b`, `tags: [a, b]` or `metadata: { tags: … }`. */
function tagsOf(d: Record<string, unknown>): string[] {
  const meta =
    d.metadata && typeof d.metadata === "object" ? (d.metadata as Record<string, unknown>) : {};
  const v = d.tags ?? meta.tags;
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [
    ...new Set(
      list
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

/** Is this link a folder? (Read-only; a dangling link or a link to a file is not.) */
async function linksToFolder(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `<root>/<folder>/SKILL.md`, one level deep. Linked folders count too, as they
 * do for Claude; Orbit only reads through them.
 */
async function findSkills(roots: ContentRoot[]): Promise<Found[]> {
  const out: Found[] = [];
  for (const root of roots)
    for (const e of await listDirSafe(root.dir)) {
      if (e.isDirectory()) {
        if ((await statSafe(join(root.dir, e.name, "SKILL.md")))?.isFile())
          out.push({ ...root, folder: e.name, linked: false, path: [] });
        else await findNested(root, [e.name], out);
      } else if (e.isSymbolicLink() && (await linksToFolder(join(root.dir, e.name))))
        out.push({ ...root, folder: e.name, linked: true, path: [] });
    }
  return out;
}

/**
 * Skills inside a grouping folder (`skills/team/lint/SKILL.md`). Claude Code doesn't
 * load these, so they're shown with that problem rather than silently missing.
 * Real folders only; a folder with SKILL.md is a skill, never searched further.
 */
async function findNested(root: ContentRoot, path: string[], out: Found[]): Promise<void> {
  if (path.length > MAX_GROUP_DEPTH) return;
  for (const e of await listDirSafe(join(root.dir, ...path))) {
    if (!e.isDirectory()) continue;
    if ((await statSafe(join(root.dir, ...path, e.name, "SKILL.md")))?.isFile())
      out.push({ ...root, folder: e.name, linked: false, path });
    else await findNested(root, [...path, e.name], out);
  }
}

async function readSkill(f: Found): Promise<SkillInfo | null> {
  const dir = join(f.dir, ...f.path, f.folder);
  const file = join(dir, "SKILL.md");
  if (!(await statSafe(file))?.isFile()) return null;
  const group = f.path.length ? f.path.join("/") : null;
  const nested = group
    ? [
        `Claude Code only loads skills one folder below skills/. Move "${f.folder}" out of "${group}" to use it.`,
      ]
    : [];
  const command = (name: string) => `/${f.plugin ? `${pluginName(f.plugin)}:` : ""}${name}`;
  const base = {
    scope: f.scope,
    plugin: f.plugin,
    dir,
    file,
    linked: f.linked,
    group,
    loaded: !group,
  };
  const md = await readMarkdown(file);
  if (!md)
    return {
      ...base,
      name: f.folder,
      description: null,
      model: null,
      allowedTools: [],
      userInvocable: true,
      modelInvocable: true,
      problems: [...nested, UNREADABLE],
      tags: [],
      argumentHint: null,
      command: command(f.folder),
    };
  const d = md.data;
  const declared = strOrNull(d.name);
  const description = strOrNull(d.description);
  const problems: string[] = [...nested];
  if (md.error) problems.push(md.error);
  if (declared && declared !== f.folder)
    problems.push(`Name in SKILL.md (${declared}) differs from its folder (${f.folder})`);
  if (!md.error && !description) problems.push(NO_DESCRIPTION);
  return {
    ...base,
    name: declared ?? f.folder,
    description,
    model: strOrNull(d.model),
    allowedTools: toolList(d["allowed-tools"]),
    userInvocable: d["user-invocable"] !== false,
    modelInvocable: d["disable-model-invocation"] !== true,
    problems,
    tags: tagsOf(d),
    argumentHint: strOrNull(d["argument-hint"]),
    command: command(declared ?? f.folder),
  };
}

/** Skills from `~/.claude/skills`, the workspace's `.claude/skills` and each plugin's `skills`. */
export async function readSkills(
  home: string,
  workspace: string | null,
  plugins: PluginRoot[],
): Promise<SkillInfo[]> {
  const found = await findSkills(contentRoots(home, workspace, plugins, "skills"));
  const skills = await mapLimit(found, PARALLEL, (f) => readSkill(f).catch(() => null));
  return skills.filter((s): s is SkillInfo => s !== null).sort(byScopeThenName);
}
