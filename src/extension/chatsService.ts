import { MtimeCache } from "../core/cache";
import { isInside } from "../core/paths";
import { applyPromptCounts, PromptCounter } from "../features/chats/history";
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

/** Reads everything the Chats tab needs, keeping a per-file cache between refreshes. */
export class ChatsService {
  private readonly cache = new MtimeCache<Session | null>();
  private readonly prompts: PromptCounter;
  private byId = new Map<string, Session>();
  private links = new Set<string>();
  private readonly platform: NodeJS.Platform;
  private readonly isAlive: (pid: number) => boolean;

  constructor(
    private readonly home: string,
    opts: Options = {},
  ) {
    this.platform = opts.platform ?? process.platform;
    this.isAlive = opts.isAlive ?? pidAlive;
    this.prompts = new PromptCounter(home);
  }

  async snapshot(workspaceFolders: string[]): Promise<ChatsSnapshot> {
    const [sessions, counts, live] = await Promise.all([
      listSessions(this.home, this.cache),
      this.prompts.update(),
      readLiveSessions(this.home, this.isAlive),
    ]);
    const items = applyPromptCounts(sessions, counts);
    this.byId = new Map(items.map((s) => [s.id, s]));
    this.links = new Set(items.flatMap((s) => s.prLinks));
    const here = items
      .filter((s) => workspaceFolders.some((f) => isInside(f, s.cwd, this.platform)))
      .map((s) => s.id);
    return { items, live: [...live.values()].filter((l) => this.byId.has(l.sessionId)), here };
  }

  /** Every pull-request link found in the person's chats. */
  isKnownLink(url: string): boolean {
    return this.links.has(url);
  }

  get(id: string): Session | undefined {
    return this.byId.get(id);
  }
}
