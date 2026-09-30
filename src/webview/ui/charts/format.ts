const compact = (v: number, digits: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** "$0.50", "$12.35", "$1,235", "$98.8K"; "—" when unknown (never guessed). */
export function formatCost(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "$0";
  if (v < 0.01) return "<$0.01";
  if (v < 100) return `$${v.toFixed(2)}`;
  if (v < 10_000) return `$${compact(Math.round(v), 0)}`;
  return `$${compact(v / 1000, 1)}K`;
}

/** "999", "1.2K", "3.4M", "1.25B". */
export function formatTokens(v: number): string {
  if (v < 1000) return String(Math.round(v));
  if (v < 1e6) return `${compact(v / 1e3, 1)}K`;
  if (v < 1e9) return `${compact(v / 1e6, 1)}M`;
  return `${compact(v / 1e9, 2)}B`;
}

/** A 0–1 ratio as a whole percentage. */
export function formatPct(ratio: number): string {
  if (ratio <= 0) return "0%";
  if (ratio < 0.01) return "<1%";
  return `${Math.round(ratio * 100)}%`;
}

export function formatResetIn(resetsAt: number, now: number): string {
  const ms = resetsAt - now;
  if (ms <= 0) return "Reset due";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "Resets in <1m";
  if (m < 60) return `Resets in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Resets in ${h}h ${m % 60}m`;
  return `Resets in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export type MeterLevel = "ok" | "warn" | "critical";

/** Plan-limit severity: calm below 75 %, warning from 75 %, critical from 90 %. */
export function meterLevel(pct: number): MeterLevel {
  if (pct >= 90) return "critical";
  if (pct >= 75) return "warn";
  return "ok";
}

/**
 * Heatmap step 0–4: 0 for no activity, otherwise the quartile among active days
 * (by the share of active days strictly below this one, so ties stay together).
 * The busiest days always get the darkest step.
 */
export function heatBucket(v: number, all: number[]): number {
  if (v <= 0) return 0;
  const active = all.filter((x) => x > 0);
  if (v >= Math.max(...active)) return 4;
  const below = active.filter((x) => x < v).length;
  return Math.max(1, Math.min(4, Math.floor((below / active.length) * 4) + 1));
}
