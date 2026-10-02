import type { QuotaFile, Window } from "../../tap/statusline";

/** Status bar colours follow the higher window: yellow from 75%, red from 90%. */
export const WARN_AT = 75;
export const CRITICAL_AT = 90;

export interface QuotaBar {
  text: string;
  tooltip: string;
  level: "normal" | "warning" | "error";
}

const time = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayTime = (t: number) =>
  new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** The plan-limit status bar item, or null when there's nothing to show. */
export function quotaBar(q: QuotaFile | null, now: number): QuotaBar | null {
  if (!q) return null;
  const windows: { short: string; long: string; w: Window; when: (t: number) => string }[] = [];
  if (q.fiveHour) windows.push({ short: "5h", long: "5-hour limit", w: q.fiveHour, when: time });
  if (q.sevenDay) windows.push({ short: "7d", long: "Weekly limit", w: q.sevenDay, when: dayTime });
  if (!windows.length) return null;

  const live = windows.filter((x) => x.w.resetsAt > now);
  const peak = Math.max(0, ...live.map((x) => x.w.pct));
  const level = peak >= CRITICAL_AT ? "error" : peak >= WARN_AT ? "warning" : "normal";
  const text = `$(sparkle) ${windows
    .map((x) => `${x.short} ${x.w.resetsAt > now ? `${Math.round(x.w.pct)}%` : "reset"}`)
    .join(" · ")}`;
  const lines = windows.map((x) =>
    x.w.resetsAt > now
      ? `${x.long}: ${Math.round(x.w.pct)}% used · resets ${x.when(x.w.resetsAt)}`
      : `${x.long}: reset since Claude last reported it`,
  );
  lines.push(`As of Claude Code's last reply at ${time(q.updatedAt)}.`);
  if (level === "error")
    lines.push("Your plan may offer a free limit reset at claude.ai → Settings → Usage.");
  lines.push("Click to see your plan limits in Orbit.");
  return { text, tooltip: lines.join("\n"), level };
}
