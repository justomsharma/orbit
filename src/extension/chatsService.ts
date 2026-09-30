import { MtimeCache } from "../core/cache";
import { normPath } from "../core/paths";
import { applyPromptCounts, readPromptCounts } from "../features/chats/history";
import { pidAlive, readLiveSessions } from "../features/chats/live";
import { listSessions } from "../features/chats/reader";
import type { LiveStatus, Session } from "../features/chats/types";

export interface ChatsSnapshot {
  items: Session[];
  live: LiveStatus[];
  here: string[];
}

interface Options {
  platform?: NodeJS.Platform;
  isAlive?: (pid: number) => boolean;
}

/** Is `cwd` the folder itself or somewhere inside it? */
export function isInside(folder: string, cwd: string, platform: NodeJS.Platform): boolean {
  if (!cwd) return false;
  const f = normPath(folder, platform);
  const c = normPath(cwd, platform);
  if (c === f) return true;
  const sep = platform === "win32" ? "\\" : "/";
  return c.startsWith(f.endsWith(sep) ? f : f + sep);
}

/** Reads everything the Chats tab needs, keeping a per-file cache between refreshes. */
export class ChatsService {
  private readonly cache = new MtimeCache<Session | null>();
  private byId = new Map<string, Session>();
  private readonly platform: NodeJS.Platform;
  private readonly isAlive: (pid: number) => boolean;

  constructor(
    private readonly home: string,
    opts: Options = {},
  ) {
    this.platform = opts.platform ?? process.platform;
    this.isAlive = opts.isAlive ?? pidAlive;
  }

  async snapshot(workspaceFolders: string[]): Promise<ChatsSnapshot> {
    const [sessions, counts, live] = await Promise.all([
      listSessions(this.home, this.cache),
      readPromptCounts(this.home),
      readLiveSessions(this.home, this.isAlive),
    ]);
    const items = applyPromptCounts(sessions, counts);
    this.byId = new Map(items.map((s) => [s.id, s]));
    const here = items
      .filter((s) => workspaceFolders.some((f) => isInside(f, s.cwd, this.platform)))
      .map((s) => s.id);
    return { items, live: [...live.values()].filter((l) => this.byId.has(l.sessionId)), here };
  }

  get(id: string): Session | undefined {
    return this.byId.get(id);
  }
}
