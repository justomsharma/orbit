import type { OrbitStore } from "../core/orbitStore";
import { PRICING_AS_OF } from "../core/pricing";
import type { Session } from "../features/chats/types";
import { heatmap, summarize, type UsageSummary } from "../features/usage/aggregate";
import { type IndexState, UsageIndex } from "../features/usage/index";
import { type Recap, recapMarkdown, weeklyRecap } from "../features/usage/recap";
import type { QuotaFile } from "../tap/statusline";

const INDEX_FILE = "usage-index.json";
const PERSIST_EVERY_MS = 60_000;
const DAY = 24 * 3600_000;

export interface QuotaSource {
  status(): Promise<{ enabled: boolean }>;
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
  quota: { enabled: boolean; data: QuotaFile | null };
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

    const r = index.records();
    const today = startOfDay(now);
    const end = now + 1;
    const [status, data] = await Promise.all([this.quota.status(), this.quota.readQuota()]);
    const recap = weeklyRecap(r, sessions, now);
    return {
      ready: true,
      today: summarize(r, today, end),
      yesterday: summarize(r, today - DAY, today),
      week: summarize(r, startOfDay(now, 6), end),
      month: summarize(r, startOfDay(now, 29), end),
      all: summarize(r, 0, end),
      heat: heatmap(r, now, 26),
      recap,
      recapMarkdown: recapMarkdown(recap),
      quota: { enabled: status.enabled, data },
      pricingAsOf: PRICING_AS_OF,
    };
  }

  /** Saves the index to Orbit's storage (also called on shutdown). */
  async flush(now = Date.now()): Promise<void> {
    if (!this.index) return;
    await this.store.write(INDEX_FILE, this.index.state());
    this.dirty = false;
    this.lastPersist = now;
  }
}
