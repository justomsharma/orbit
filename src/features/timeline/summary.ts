import { join } from "node:path";
import { mapLimit } from "../../core/concurrency";
import { listDirSafe, statSafe } from "../../core/fsSafe";
import { fileHistoryDir } from "../../core/paths";
import { isSessionId } from "../../core/uuid";

/** Claude's checkpoint blobs: `<16 hex of the path's hash>@v<version>`. */
const BLOB = /^([0-9a-f]{16})@v\d+$/;
const PARALLEL = 8;

/** How much Claude kept for one chat: files it backed up, versions in all, bytes on disk. */
export interface CheckpointSummary {
  id: string;
  files: number;
  versions: number;
  bytes: number;
}

const cache = new Map<string, { mtimeMs: number; s: CheckpointSummary }>();

async function summarize(dir: string, id: string): Promise<CheckpointSummary | null> {
  const st = await statSafe(dir);
  if (!st?.isDirectory()) return null;
  const hit = cache.get(dir);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.s;
  const files = new Set<string>();
  let versions = 0;
  const blobs = (await listDirSafe(dir)).filter((e) => e.isFile() && BLOB.test(e.name));
  const sizes = await mapLimit(
    blobs,
    PARALLEL,
    async (e) => (await statSafe(join(dir, e.name)))?.size ?? 0,
  );
  for (const e of blobs) {
    files.add(e.name.match(BLOB)![1]!);
    versions++;
  }
  const s: CheckpointSummary = {
    id,
    files: files.size,
    versions,
    bytes: sizes.reduce((a, b) => a + b, 0),
  };
  cache.set(dir, { mtimeMs: st.mtimeMs, s });
  return s;
}

/** Every chat with file checkpoints (folders named by chat id), unordered. */
export async function checkpointSummaries(home: string): Promise<CheckpointSummary[]> {
  const root = fileHistoryDir(home);
  const dirs = (await listDirSafe(root)).filter((e) => e.isDirectory() && isSessionId(e.name));
  const all = await mapLimit(dirs, PARALLEL, (e) => summarize(join(root, e.name), e.name));
  return all.filter((s): s is CheckpointSummary => s !== null && s.versions > 0);
}
