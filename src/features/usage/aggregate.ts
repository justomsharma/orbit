import { normPath } from "../../core/paths";
import { costOf, priceFor } from "../../core/pricing";
import type { UsageRecord } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 400;
const TOP_SESSIONS = 10;

export interface UsageSummary {
  range: { from: number; to: number };
  /** Dollars for priced records; null only when records exist and none could be priced. */
  cost: number | null;
  unpricedModels: string[];
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Share of prompt tokens served from cache. */
  cacheHitRate: number;
  messages: number;
  sessions: number;
  daily: { day: string; cost: number; tokens: number }[];
  byModel: { model: string; cost: number | null; tokens: number }[];
  byProject: { cwd: string; cost: number; tokens: number }[];
  topSessions: { session: string; cwd: string; cost: number; tokens: number }[];
  /** Built-in tools by how many replies used them, most first. */
  tools: { name: string; count: number }[];
  /** MCP servers (from `mcp__server__tool` names) by calls, most first. */
  mcp: { server: string; count: number; tools: number }[];
}

const TOP_TOOLS = 12;

/** `mcp__github__create_issue` → "github" (server names may contain "_"). */
export function mcpServerOf(tool: string): string | null {
  const m = tool.match(/^mcp__(.+?)__[^_].*$/);
  return m ? m[1]! : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar day, `YYYY-MM-DD`. */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Every token of a record: input, output, cache reads and cache writes. */
export const totalTokens = (r: UsageRecord) =>
  r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;

/** Local days from `first` to `last` inclusive, stepping by calendar day so DST can't skip one. */
function days(first: number, last: number, max: number): string[] {
  if (last < first) return [];
  const f = new Date(Math.max(first, last - (max + 2) * DAY));
  const end = dayKey(last);
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const k = dayKey(new Date(f.getFullYear(), f.getMonth(), f.getDate() + i).getTime());
    if (k > end) break;
    out.push(k);
  }
  return out.slice(-max);
}

type Sortable = { cost: number | null; tokens: number };
const byCostThenTokens = (a: Sortable, b: Sortable) =>
  (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens;

/** Totals for records with `from <= t < to`. */
export function summarize(records: UsageRecord[], from: number, to: number): UsageSummary {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  let priced = 0;
  let messages = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  const unpriced = new Set<string>();
  const sessions = new Map<
    string,
    { session: string; cwd: string; cost: number; tokens: number }
  >();
  const models = new Map<string, { model: string; cost: number | null; tokens: number }>();
  const projects = new Map<string, { cwd: string; cost: number; tokens: number }>();
  const perDay = new Map<string, { cost: number; tokens: number }>();
  const toolCount = new Map<string, number>();
  const mcpCount = new Map<string, { count: number; tools: Set<string> }>();

  for (const r of records) {
    if (r.t < from || r.t >= to) continue;
    messages++;
    first = Math.min(first, r.t);
    last = Math.max(last, r.t);
    const c = costOf(r);
    const known = c ?? 0;
    const tk = totalTokens(r);
    if (c === null) unpriced.add(r.model);
    else {
      cost += c;
      priced++;
    }
    tokens.input += r.input;
    tokens.output += r.output;
    tokens.cacheRead += r.cacheRead;
    tokens.cacheWrite += r.cacheWrite5m + r.cacheWrite1h;

    const m = models.get(r.model) ?? {
      model: r.model,
      cost: priceFor(r.model) ? 0 : null,
      tokens: 0,
    };
    if (m.cost !== null) m.cost += known;
    m.tokens += tk;
    models.set(r.model, m);

    const pk = normPath(r.cwd);
    const p = projects.get(pk) ?? { cwd: r.cwd, cost: 0, tokens: 0 };
    p.cost += known;
    p.tokens += tk;
    projects.set(pk, p);

    const s = sessions.get(r.session) ?? { session: r.session, cwd: r.cwd, cost: 0, tokens: 0 };
    s.cost += known;
    s.tokens += tk;
    sessions.set(r.session, s);

    for (const name of r.tools ?? []) {
      const server = mcpServerOf(name);
      if (server) {
        const e = mcpCount.get(server) ?? { count: 0, tools: new Set<string>() };
        e.count++;
        e.tools.add(name);
        mcpCount.set(server, e);
      } else toolCount.set(name, (toolCount.get(name) ?? 0) + 1);
    }

    const dk = dayKey(r.t);
    const d = perDay.get(dk) ?? { cost: 0, tokens: 0 };
    d.cost += known;
    d.tokens += tk;
    perDay.set(dk, d);
  }

  // A bounded range shows every day in it; "all time" starts at the first record.
  const bounded = Number.isFinite(from) && Number.isFinite(to) && to - from <= MAX_DAYS * DAY;
  const start = bounded ? from : first;
  const end = Number.isFinite(to) ? to - 1 : last;
  const daily = Number.isFinite(start)
    ? days(start, end, MAX_DAYS).map((day) => ({
        day,
        ...(perDay.get(day) ?? { cost: 0, tokens: 0 }),
      }))
    : [];

  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return {
    range: { from, to },
    cost: messages > 0 && priced === 0 ? null : cost,
    unpricedModels: [...unpriced].sort(),
    tokens,
    cacheHitRate: prompt > 0 ? tokens.cacheRead / prompt : 0,
    messages,
    sessions: sessions.size,
    daily,
    byModel: [...models.values()].sort(byCostThenTokens),
    byProject: [...projects.values()].sort(byCostThenTokens),
    topSessions: [...sessions.values()].sort(byCostThenTokens).slice(0, TOP_SESSIONS),
    tools: [...toolCount]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, TOP_TOOLS),
    mcp: [...mcpCount]
      .map(([server, e]) => ({ server, count: e.count, tools: e.tools.size }))
      .sort((a, b) => b.count - a.count || a.server.localeCompare(b.server)),
  };
}

/** Tokens per local day for the last `weeks` weeks, oldest first, ending today. */
export function heatmap(
  records: UsageRecord[],
  now: number,
  weeks = 26,
): { day: string; tokens: number }[] {
  const n = weeks * 7;
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (n - 1)).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const totals = new Map(days(start, now, n).map((day) => [day, 0]));
  for (const r of records) {
    if (r.t < start || r.t >= end) continue;
    const k = dayKey(r.t);
    totals.set(k, (totals.get(k) ?? 0) + totalTokens(r));
  }
  return [...totals].map(([day, tokens]) => ({ day, tokens }));
}
