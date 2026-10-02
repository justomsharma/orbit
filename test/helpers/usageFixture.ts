import type { UsageSnapshot } from "../../src/extension/usageService";
import type { UsageSummary } from "../../src/features/usage/aggregate";

const p = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

export function sampleSummary(days: number, costPerDay = 4, now = Date.now()): UsageSummary {
  const daily = Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const cost = i % 6 === 5 ? 0 : costPerDay * (0.5 + ((i * 37) % 10) / 10);
    return { day: key(d), cost, tokens: Math.round(cost * 250_000) };
  });
  const cost = daily.reduce((a, d) => a + d.cost, 0);
  const tokens = daily.reduce((a, d) => a + d.tokens, 0);
  return {
    range: { from: now - days * 86_400_000, to: now },
    cost,
    unpricedModels: [],
    tokens: {
      input: tokens * 0.01,
      output: tokens * 0.04,
      cacheRead: tokens * 0.85,
      cacheWrite: tokens * 0.1,
    },
    cacheHitRate: 0.85,
    messages: days * 40,
    sessions: Math.max(1, Math.round(days / 2)),
    daily,
    byModel: [
      { model: "claude-opus-5-5", cost: cost * 0.8, tokens: tokens * 0.8 },
      { model: "claude-sonnet-5-5", cost: cost * 0.2, tokens: tokens * 0.2 },
    ],
    tools: [
      { name: "Read", count: days * 30 },
      { name: "Edit", count: days * 18 },
      { name: "Bash", count: days * 12 },
      { name: "Grep", count: days * 6 },
    ],
    mcp: [{ server: "github", count: days * 3, tools: 4 }],
    byProject: [
      { cwd: "/Users/ana/code/shop", cost: cost * 0.6, tokens: tokens * 0.6 },
      { cwd: "/Users/ana/code/api", cost: cost * 0.4, tokens: tokens * 0.4 },
    ],
    topSessions: [
      {
        session: "00000000-0000-4000-8000-000000000001",
        cwd: "/Users/ana/code/shop",
        cost: cost * 0.3,
        tokens: tokens * 0.3,
      },
    ],
  };
}

export function sampleUsage(over: Partial<UsageSnapshot> = {}, now = Date.now()): UsageSnapshot {
  return {
    ready: true,
    today: sampleSummary(1, 4.2, now),
    yesterday: sampleSummary(1, 3.1, now - 86_400_000),
    week: sampleSummary(7, 4, now),
    month: sampleSummary(30, 4, now),
    all: sampleSummary(120, 4, now),
    heat: Array.from({ length: 182 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (181 - i));
      return { day: key(d), tokens: i % 5 === 0 ? 0 : ((i * 7919) % 13) * 100_000 };
    }),
    year: (() => {
      const today = new Date(now);
      const back = (today.getDay() + 6) % 7;
      const n = 51 * 7 + back + 1;
      return Array.from({ length: n }, (_, i) => {
        const d = new Date(now);
        d.setDate(d.getDate() - (n - 1 - i));
        const t = i % 5 === 0 ? 0 : ((i * 7919) % 13) * 100_000;
        return {
          day: key(d),
          tokens: t,
          messages: t ? (i % 9) + 1 : 0,
          sessions: t ? (i % 3) + 1 : 0,
        };
      });
    })(),
    longest: { month: (5 * 60 + 12) * 60_000, all: (35 * 24 + 12) * 3_600_000 },
    recap: {
      from: now - 6 * 86_400_000,
      to: now,
      chats: 12,
      prompts: 148,
      cost: 28.4,
      tokens: 7_100_000,
      activeDays: 5,
      busiestDay: "Tuesday",
      topProjects: [
        { name: "shop", chats: 7 },
        { name: "api", chats: 5 },
      ],
      prs: ["https://github.com/acme/shop/pull/412"],
      models: ["claude-opus-5-5"],
    },
    recapMarkdown: "## My week with Claude Code\n- 12 chats",
    quota: { enabled: false, shadowed: false, data: null },
    pricingAsOf: "2026-09-30",
    ...over,
  };
}
