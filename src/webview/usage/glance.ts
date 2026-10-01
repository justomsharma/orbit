const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar day, `YYYY-MM-DD` (as the usage index keys its days). */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Small usage facts for the glance strip, from per-day token totals (oldest first). */
export interface Glance {
  /** Days in a row with usage, up to today (or yesterday, if today has none yet). */
  streak: number;
  best: number;
  /** Days with usage among the last `of` days. */
  active: number;
  of: number;
}

export function glance(
  daily: { day: string; tokens: number }[],
  today: string,
  window = 30,
): Glance {
  const used = daily.map((d) => d.tokens > 0);
  let best = 0;
  let run = 0;
  for (const u of used) {
    run = u ? run + 1 : 0;
    best = Math.max(best, run);
  }
  // The last entry is today when the range reaches today.
  let i = daily.length - 1;
  if (i >= 0 && daily[i]!.day === today && !used[i]) i--;
  let streak = 0;
  while (i >= 0 && used[i]) {
    streak++;
    i--;
  }
  const recent = used.slice(-window);
  return {
    streak,
    best,
    active: recent.filter(Boolean).length,
    of: Math.min(window, recent.length),
  };
}

/** The model with the most tokens, if any. */
export function favourite<T extends { model: string; tokens: number }>(byModel: T[]): T | null {
  return byModel.reduce<T | null>((top, m) => (!top || m.tokens > top.tokens ? m : top), null);
}
