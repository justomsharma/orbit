import type { UsageSummary } from "../../features/usage/aggregate";
import type { Bar } from "../ui/charts/BarChart";
import { formatCost } from "../ui/charts/format";

/** "2026-01-01" → local Date (not UTC). */
function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

const MAX_DAILY_BARS = 90;

/** One bar per day, or per week once a range is longer than 90 days. */
export function dailyBars(s: UsageSummary, locale?: string): Bar[] {
  if (s.daily.length <= MAX_DAILY_BARS) {
    return s.daily.map((d) => ({
      key: d.day,
      label: parseDay(d.day).toLocaleDateString(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      value: d.cost,
      display: formatCost(d.cost),
    }));
  }
  const bars: Bar[] = [];
  for (let i = 0; i < s.daily.length; i += 7) {
    const week = s.daily.slice(i, i + 7);
    const cost = week.reduce((a, d) => a + d.cost, 0);
    const first = parseDay(week[0]!.day);
    bars.push({
      key: week[0]!.day,
      label: `Week of ${first.toLocaleDateString(locale, { month: "short", day: "numeric" })}`,
      value: cost,
      display: formatCost(cost),
    });
  }
  return bars;
}

/** "+$1.10 vs yesterday" — null when either side is unknown or they are equal. */
export function costDelta(
  today: number | null,
  yesterday: number | null,
): { text: string; up: boolean } | null {
  if (today === null || yesterday === null) return null;
  const diff = Math.round((today - yesterday) * 100) / 100;
  if (diff === 0) return null;
  const sign = diff > 0 ? "+" : "−";
  return { text: `${sign}${formatCost(Math.abs(diff))} vs yesterday`, up: diff > 0 };
}

export function greeting(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function projectLabel(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "Unknown project";
}

export function quotaFreshness(updatedAt: number, now: number): string {
  const m = Math.floor((now - updatedAt) / 60_000);
  if (m < 1) return "Updated just now";
  if (m < 60) return `Updated ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Updated ${h}h ago`;
  return `Updated ${Math.floor(h / 24)}d ago`;
}
