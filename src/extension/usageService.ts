import type { OrbitStore } from "../core/orbitStore";
import { PRICING_AS_OF } from "../core/pricing";
import type { Session } from "../features/chats/types";
import { heatmap, summarize, type UsageSummary } from "../features/usage/aggregate";
import { type IndexState, UsageIndex } from "../features/usage/index";
import { type Recap, recapMarkdown, weeklyRecap } from "../features/usage/recap";
import type { QuotaFile } from "../tap/statusline";

const INDEX_FILE = "usage-index.json";
const PERSIST_EVERY_MS = 60_000;

export interface QuotaSource {
  status(): Promise<{ enabled: boolean; shadowed?: boolean }>;
  readQuota(): Promise<QuotaFile | null>;
}

export interface UsageSnapshot {
  ready: boolean;
  today: UsageSummary;
  yesterday: UsageSummary;
  week: UsageSummary;
  month: UsageSummary;
  all: UsageSummary;
  heat: { day: string; tokens: number }[];
  recap: Recap;
  recapMarkdown: string;
  /** `shadowed`: a project statusline hides Orbit's there, so limits won't update in it. */
  quota: { enabled: boolean; shadowed: boolean; data: QuotaFile | null };
  pricingAsOf: string;
}

function startOfDay(t: number, daysBack = 0): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

/** Keeps the incremental usage index up to date and turns it into what the Usage and Home tabs show. */
export class UsageService {
  private index: UsageIndex | null = null;
  private dirty = false;
  private lastPersist = 0;
  private last: { key: string; snap: UsageSnapshot } | null = null;

  constructor(
    private readonly home: string,
    private readonly store: OrbitStore,
    private readonly quota: QuotaSource,
  ) {}

  private async ensureIndex(): Promise<UsageIndex> {
    if (!this.index) {
      const saved = await this.store.read<IndexState | undefined>(INDEX_FILE, undefined);
      this.index = new UsageIndex(this.home, saved);
    }
    return this.index;
  }

  async snapshot(sessions: Session[], now: number): Promise<UsageSnapshot> {
    const index = await this.ensureIndex();
    const { changed } = await index.update();
    if (changed) this.dirty = true;
    if (this.dirty && now - this.lastPersist > PERSIST_EVERY_MS) await this.flush(now);

    const today = startOfDay(now);
    const [status, data] = await Promise.all([this.quota.status(), this.quota.readQuota()]);
    // Nothing new since last time (same day, same quota, same chats): reuse it.
    const newest = sessions.reduce((m, x) => Math.max(m, x.lastActiveAt), 0);
    const key = [
      today,
      status.enabled,
      status.shadowed,
      data?.updatedAt,
      sessions.length,
      newest,
    ].join("|");
    if (!changed && this.last?.key === key) return this.last.snap;

    const r = index.records();
    const end = now + 1;
    const recap = weeklyRecap(r, sessions, now);
    const snap: UsageSnapshot = {
      ready: true,
      today: summarize(r, today, end),
      // Calendar days, so a daylight-saving change can't shift "yesterday".
      yesterday: summarize(r, startOfDay(now, 1), today),
      week: summarize(r, startOfDay(now, 6), end),
      month: summarize(r, startOfDay(now, 29), end),
      all: summarize(r, 0, end),
      heat: heatmap(r, now, 26),
      recap,
      recapMarkdown: recapMarkdown(recap),
      quota: { enabled: status.enabled, shadowed: status.shadowed === true, data },
      pricingAsOf: PRICING_AS_OF,
    };
    this.last = { key, snap };
    return snap;
  }

  /** Saves the index to Orbit's storage (also called on shutdown). */
  async flush(now = Date.now()): Promise<void> {
    if (!this.index) return;
    await this.store.write(INDEX_FILE, this.index.state());
    this.dirty = false;
    this.lastPersist = now;
  }
}
