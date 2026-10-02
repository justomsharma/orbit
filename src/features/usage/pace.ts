/** Plan-limit windows Claude Code reports: their length and how long before a pace means anything. */
export const WEEK = { ms: 7 * 24 * 3_600_000, minElapsed: 12 * 3_600_000 } as const;
export const FIVE_HOURS = { ms: 5 * 3_600_000, minElapsed: 30 * 60_000 } as const;

export type Verdict = "under" | "on-track" | "ahead";

export interface Pace {
  /** Share of the window's allowance used by its end at the current rate. */
  projected: number;
  verdict: Verdict;
  /** When 100% is reached at this rate (epoch ms), if before the reset. */
  exhaustsAt: number | null;
}

/**
 * Where a window is heading: use so far divided by how much of the window has
 * passed (measured from when Claude reported it). Null until enough time has passed.
 */
export function pace(
  w: { pct: number; resetsAt: number },
  capturedAt: number,
  win: { ms: number; minElapsed: number },
): Pace | null {
  const remaining = w.resetsAt - capturedAt;
  if (!w.resetsAt || remaining <= 0 || remaining > win.ms) return null;
  const elapsed = win.ms - remaining;
  if (elapsed < win.minElapsed) return null;
  const used = Math.max(0, w.pct);
  const projected = used / (elapsed / win.ms);
  const verdict: Verdict = projected >= 110 ? "ahead" : projected <= 90 ? "under" : "on-track";
  let exhaustsAt: number | null = null;
  if (used > 0 && used < 100 && projected > 100) {
    const at = capturedAt + ((100 - used) / used) * elapsed;
    if (at < w.resetsAt) exhaustsAt = at;
  }
  return { projected, verdict, exhaustsAt };
}

/** "45m", "3h", "2d 4h". */
export function roughDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** The plain-words verdict, its explanation, and "out in …" when you'll run out first. */
export function paceText(
  p: Pace,
  span: "week" | "5 hours",
  now: number,
): { sentence: string; detail: string; outIn: string | null } {
  const the = span === "week" ? "the week" : "the 5 hours";
  const sentence = p.verdict === "ahead" ? `Not enough to last ${the}.` : `Enough to last ${the}.`;
  const detail = `${sentence} At this rate you'd use about ${Math.round(p.projected)}% of ${span === "week" ? "the week's" : "this window's"} allowance; the faint bar shows where that lands.`;
  const left = p.exhaustsAt === null ? 0 : p.exhaustsAt - now;
  return {
    sentence,
    detail,
    outIn: p.verdict === "ahead" && left > 0 ? `out in ${roughDuration(left)}` : null,
  };
}
