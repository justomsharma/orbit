import { MtimeCache } from "../core/cache";
import { mapLimit } from "../core/concurrency";
import { readHeadTail, statSafe } from "../core/fsSafe";
import { isInside } from "../core/paths";
import { applyPromptCounts, PromptCounter } from "../features/chats/history";
import { pendingQuestion, pidAlive, readLiveSessions } from "../features/chats/live";
import { listSessions } from "../features/chats/reader";
import type { LiveStatus, Session } from "../features/chats/types";
import { type WorktreeInfo, worktreeOf } from "../features/chats/worktree";

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
  private readonly worktrees = new Map<string, { at: number; w: WorktreeInfo | null }>();
  private readonly questions = new Map<
    string,
    { mtimeMs: number; size: number; pending: boolean }
  >();
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
    const items = await this.withWorktrees(applyPromptCounts(sessions, counts));
    this.byId = new Map(items.map((s) => [s.id, s]));
    this.links = new Set(items.flatMap((s) => s.prLinks));
    const here = items
      .filter((s) => workspaceFolders.some((f) => isInside(f, s.cwd, this.platform)))
      .map((s) => s.id);
    const running = await Promise.all(
      [...live.values()]
        .filter((l) => this.byId.has(l.sessionId))
        .map(async (l) =>
          l.status !== "waiting" && (await this.asking(this.byId.get(l.sessionId)!.file))
            ? { ...l, status: "waiting" as const }
            : l,
        ),
    );
    return { items, live: running, here };
  }

  /** Marks chats that ran in a git worktree (each folder checked once a minute). */
  private async withWorktrees(items: Session[]): Promise<Session[]> {
    const now = Date.now();
    const cwds = [...new Set(items.map((s) => s.cwd))];
    await mapLimit(cwds, 16, async (cwd) => {
      const hit = this.worktrees.get(cwd);
      if (hit && now - hit.at < 60_000) return;
      this.worktrees.set(cwd, { at: now, w: await worktreeOf(cwd) });
    });
    return items.map((s) => {
      const w = this.worktrees.get(s.cwd)?.w ?? null;
      return w ? { ...s, worktree: w } : s;
    });
  }

  /** Claude's question or plan waiting for an answer at the end of the chat (cached per file). */
  private async asking(file: string): Promise<boolean> {
    const st = await statSafe(file);
    if (!st) return false;
    const hit = this.questions.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.pending;
    const ht = await readHeadTail(file, 0, 32 * 1024);
    const pending = ht ? pendingQuestion(ht.head + ht.tail) : false;
    this.questions.set(file, { mtimeMs: st.mtimeMs, size: st.size, pending });
    if (this.questions.size > 200) this.questions.delete(this.questions.keys().next().value!);
    return pending;
  }

  /** Every pull-request link found in the person's chats. */
  isKnownLink(url: string): boolean {
    return this.links.has(url);
  }

  get(id: string): Session | undefined {
    return this.byId.get(id);
  }

  /** Every chat from the last snapshot, most recent first. */
  all(): Session[] {
    return [...this.byId.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }
}
