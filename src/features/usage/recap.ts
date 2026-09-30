import { normPath } from "../../core/paths";
import { modelLabel } from "../../core/pricing";
import type { Session } from "../chats/types";
import { dayKey, summarize } from "./aggregate";
import type { UsageRecord } from "./types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TOP_PROJECTS = 3;

export interface Recap {
  from: number;
  /** Exclusive: local midnight after today. */
  to: number;
  chats: number;
  prompts: number;
  cost: number | null;
  tokens: number;
  activeDays: number;
  /** Weekday name with the most tokens, e.g. "Tuesday". */
  busiestDay: string | null;
  topProjects: { name: string; chats: number }[];
  prs: string[];
  /** Model ids used, biggest first. */
  models: string[];
}

const weekday = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return WEEKDAYS[new Date(y!, m! - 1, d!).getDay()]!;
};

/** The last seven local days, today included. */
export function weeklyRecap(records: UsageRecord[], sessions: Session[], now: number): Recap {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime();
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const s = summarize(records, from, to);
  const chats = sessions.filter((c) => c.lastActiveAt >= from && c.lastActiveAt < to);

  const active = new Set(s.daily.filter((x) => x.tokens > 0).map((x) => x.day));
  for (const c of chats) active.add(dayKey(c.lastActiveAt));

  let busiest: { day: string; tokens: number } | null = null;
  for (const x of s.daily) if (x.tokens > (busiest?.tokens ?? 0)) busiest = x;

  const projects = new Map<string, { name: string; chats: number }>();
  for (const c of chats) {
    const k = normPath(c.cwd);
    const p = projects.get(k) ?? { name: c.project, chats: 0 };
    p.chats++;
    projects.set(k, p);
  }

  return {
    from,
    to,
    chats: chats.length,
    prompts: chats.reduce((a, c) => a + c.prompts, 0),
    cost: s.cost,
    tokens: s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite,
    activeDays: active.size,
    busiestDay: busiest ? weekday(busiest.day) : null,
    topProjects: [...projects.values()]
      .sort((a, b) => b.chats - a.chats || a.name.localeCompare(b.name))
      .slice(0, TOP_PROJECTS),
    prs: [...new Set(chats.flatMap((c) => c.prLinks))],
    models: s.byModel.map((m) => m.model),
  };
}

const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** 999 · 12.3K · 1.2M · 3.4B */
export function formatTokens(n: number): string {
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, unit] of units) {
    if (n >= size) return `${(n / size).toFixed(1).replace(/\.0$/, "")}${unit}`;
  }
  return String(Math.round(n));
}

const formatCost = (c: number) => (c > 0 && c < 0.01 ? "<$0.01" : `$${c.toFixed(2)}`);

const shortDate = (t: number) => {
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

/** A short Markdown note about the week, safe to share: names only, no paths or links. */
export function recapMarkdown(r: Recap): string {
  const lastDay = new Date(r.to);
  lastDay.setDate(lastDay.getDate() - 1);
  const lines = [
    `**My week with Claude Code** · ${shortDate(r.from)} – ${shortDate(lastDay.getTime())}`,
    "",
  ];
  if (r.chats === 0 && r.tokens === 0) {
    lines.push("A quiet week — no Claude Code chats.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `- ${plural(r.chats, "chat")}, ${plural(r.prompts, "prompt")}, ${plural(r.activeDays, "active day")}`,
  );
  const usage = [`${formatTokens(r.tokens)} tokens`];
  if (r.cost !== null) usage.push(formatCost(r.cost));
  lines.push(`- ${usage.join(" · ")}`);
  if (r.busiestDay) lines.push(`- Busiest day: ${r.busiestDay}`);
  if (r.topProjects.length) {
    lines.push(`- Top projects: ${r.topProjects.map((p) => `${p.name} (${p.chats})`).join(", ")}`);
  }
  const models = [...new Set(r.models.map(modelLabel))];
  if (models.length) lines.push(`- Models: ${models.join(", ")}`);
  if (r.prs.length) lines.push(`- ${plural(r.prs.length, "pull request")}`);
  return `${lines.join("\n")}\n`;
}
