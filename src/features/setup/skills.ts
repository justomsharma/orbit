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
}

interface Found extends ContentRoot {
  folder: string;
}

/** `<root>/<folder>/SKILL.md`, one level deep. Linked folders are not followed. */
async function findSkills(roots: ContentRoot[]): Promise<Found[]> {
  const out: Found[] = [];
  for (const root of roots)
    for (const e of await listDirSafe(root.dir))
      if (e.isDirectory()) out.push({ ...root, folder: e.name });
  return out;
}

async function readSkill(f: Found): Promise<SkillInfo | null> {
  const dir = join(f.dir, f.folder);
  const file = join(dir, "SKILL.md");
  if (!(await statSafe(file))?.isFile()) return null;
  const base = { scope: f.scope, plugin: f.plugin, dir, file };
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
      problems: [UNREADABLE],
    };
  const d = md.data;
  const declared = strOrNull(d.name);
  const description = strOrNull(d.description);
  const problems: string[] = [];
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
