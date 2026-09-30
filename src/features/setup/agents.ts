import { join } from "node:path";
import { mapLimit } from "../../core/concurrency";
import { listDirSafe } from "../../core/fsSafe";
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

export interface AgentInfo {
  name: string;
  description: string | null;
  tools: string[];
  model: string | null;
  scope: ContentScope;
  plugin: string | null;
  file: string;
  problems: string[];
}

const MODEL_ALIASES = new Set(["sonnet", "opus", "haiku", "fable", "inherit"]);

export const isKnownModel = (m: string) => MODEL_ALIASES.has(m) || m.startsWith("claude-");

interface Found extends ContentRoot {
  file: string;
  stem: string;
}

async function readAgent(f: Found): Promise<AgentInfo> {
  const base = { scope: f.scope, plugin: f.plugin, file: f.file };
  const md = await readMarkdown(f.file);
  if (!md)
    return {
      ...base,
      name: f.stem,
      description: null,
      tools: [],
      model: null,
      problems: [UNREADABLE],
    };
  const d = md.data;
  const description = strOrNull(d.description);
  const model = strOrNull(d.model);
  const problems: string[] = [];
  if (md.error) problems.push(md.error);
  else if (!description) problems.push(NO_DESCRIPTION);
  if (model && !isKnownModel(model)) problems.push(`Unknown model '${model}'`);
  return {
    ...base,
    name: strOrNull(d.name) ?? f.stem,
    description,
    tools: toolList(d.tools),
    model,
    problems,
  };
}

/** Subagents: `*.md` directly in `~/.claude/agents`, the workspace's `.claude/agents` and each plugin. */
export async function readAgents(
  home: string,
  workspace: string | null,
  plugins: PluginRoot[],
): Promise<AgentInfo[]> {
  const found: Found[] = [];
  for (const root of contentRoots(home, workspace, plugins, "agents"))
    for (const e of await listDirSafe(root.dir))
      if (e.isFile() && e.name.toLowerCase().endsWith(".md"))
        found.push({ ...root, file: join(root.dir, e.name), stem: e.name.slice(0, -3) });
  const agents = await mapLimit(found, PARALLEL, (f) => readAgent(f).catch(() => null));
  return agents.filter((a): a is AgentInfo => a !== null).sort(byScopeThenName);
}
