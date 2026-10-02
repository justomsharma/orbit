import { samePath } from "../core/paths";
import type { Session } from "../features/chats/types";
import type { ChatSet } from "./state";

interface Pending<T> {
  terminal: T;
  cwd: string;
  startedAt: number;
  before: Set<string>;
  ids: Set<string>;
}

export interface TempDeps {
  mark(set: ChatSet, ids: string[], on: boolean): Promise<void>;
  marked(set: ChatSet): string[];
  platform: NodeJS.Platform;
}

/**
 * Temporary chats: tagged "Temp" while their terminal is open, and hidden from
 * the list when it closes (Orbit never deletes a transcript; "Make permanent"
 * keeps one). Works with any terminal type, so it's tested without VS Code.
 */
export class TempChats<T> {
  private readonly pending: Pending<T>[] = [];

  constructor(private readonly d: TempDeps) {}

  /** A temporary chat is starting in `terminal`, in `cwd`, next to the chats already there. */
  started(terminal: T, cwd: string, existing: string[], now = Date.now()): void {
    this.pending.push({ terminal, cwd, startedAt: now, before: new Set(existing), ids: new Set() });
  }

  /** New chats in a temporary chat's folder belong to it. */
  async seen(items: Session[]): Promise<void> {
    for (const p of this.pending) {
      const fresh = items.filter(
        (s) =>
          !p.before.has(s.id) &&
          !p.ids.has(s.id) &&
          s.startedAt >= p.startedAt - 2000 &&
          samePath(s.cwd, p.cwd, this.d.platform),
      );
      if (!fresh.length) continue;
      for (const s of fresh) p.ids.add(s.id);
      await this.d.mark(
        "temp",
        fresh.map((s) => s.id),
        true,
      );
    }
  }

  /** Its terminal closed: hide the chats still marked temporary. */
  async closed(terminal: T): Promise<void> {
    const i = this.pending.findIndex((p) => p.terminal === terminal);
    if (i < 0) return;
    const [p] = this.pending.splice(i, 1);
    const temp = new Set(this.d.marked("temp"));
    const hide = [...p!.ids].filter((id) => temp.has(id));
    if (hide.length) await this.d.mark("hidden", hide, true);
  }

  /** After a restart: temporary chats that aren't running any more get hidden. */
  async sweep(liveIds: string[]): Promise<void> {
    const live = new Set(liveIds);
    const mine = new Set(this.pending.flatMap((p) => [...p.ids]));
    const hidden = new Set(this.d.marked("hidden"));
    const stale = this.d
      .marked("temp")
      .filter((id) => !live.has(id) && !mine.has(id) && !hidden.has(id));
    if (stale.length) await this.d.mark("hidden", stale, true);
  }
}
