import { join } from "node:path";
import { mapLimit } from "../../core/concurrency";
import { listDirSafe, statSafe } from "../../core/fsSafe";
import { projectsDir } from "../../core/paths";
import { isSessionId } from "../../core/uuid";

const PARALLEL = 16;

export interface UsageFile {
  file: string;
  /** Session the file belongs to, from its name (used when a line has no `sessionId`). */
  session: string;
}

/**
 * Every transcript that can hold usage: `projects/<slug>/<uuid>.jsonl` and
 * `projects/<slug>/<uuid>/subagents/*.jsonl`. Symlinks are never followed. Sorted by path.
 */
export async function usageFiles(home: string): Promise<UsageFile[]> {
  const root = projectsDir(home);
  const out: UsageFile[] = [];
  const agentDirs: UsageFile[] = [];
  const projects = (await listDirSafe(root)).filter((d) => d.isDirectory());
  await mapLimit(projects, PARALLEL, async (p) => {
    const dir = join(root, p.name);
    for (const e of await listDirSafe(dir)) {
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        const id = e.name.slice(0, -".jsonl".length);
        if (isSessionId(id)) out.push({ file: join(dir, e.name), session: id });
      } else if (e.isDirectory() && isSessionId(e.name)) {
        agentDirs.push({ file: join(dir, e.name, "subagents"), session: e.name });
      }
    }
  });
  await mapLimit(agentDirs, PARALLEL, async ({ file: dir, session }) => {
    if (!(await statSafe(dir))?.isDirectory()) return;
    for (const e of await listDirSafe(dir)) {
      if (e.isFile() && e.name.endsWith(".jsonl")) out.push({ file: join(dir, e.name), session });
    }
  });
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
