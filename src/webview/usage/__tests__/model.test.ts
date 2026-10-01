import { describe, expect, it } from "vitest";
import type { UsageSummary } from "../../../features/usage/aggregate";
import { costDelta, dailyBars, greeting, projectLabel, quotaFreshness } from "../model";

function summary(daily: { day: string; cost: number; tokens: number }[]): UsageSummary {
  return {
    range: { from: 0, to: 1 },
    cost: daily.reduce((a, d) => a + d.cost, 0),
    unpricedModels: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cacheHitRate: 0,
    messages: 0,
    sessions: 0,
    daily,
    byModel: [],
    byProject: [],
    topSessions: [],
    tools: [],
    mcp: [],
  };
}

const day = (i: number) => {
  const d = new Date(2026, 0, 1);
  d.setDate(d.getDate() + i);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe("dailyBars", () => {
  it("keeps one bar per day for up to 90 days", () => {
    const s = summary(Array.from({ length: 30 }, (_, i) => ({ day: day(i), cost: i, tokens: 1 })));
    const bars = dailyBars(s, "en-US");
    expect(bars).toHaveLength(30);
    expect(bars[0]).toMatchObject({
      key: "2026-01-01",
      label: "Thu, Jan 1",
      value: 0,
      display: "$0",
    });
    expect(bars[29]).toMatchObject({ value: 29, display: "$29.00" });
  });

  it("groups longer ranges into weeks so bars stay readable", () => {
    const s = summary(Array.from({ length: 200 }, (_, i) => ({ day: day(i), cost: 1, tokens: 1 })));
    const bars = dailyBars(s, "en-US");
    expect(bars.length).toBe(29);
    expect(bars[0]!.label).toBe("Week of Jan 1");
    expect(bars[0]!.value).toBe(7);
    expect(bars[28]!.value).toBe(4);
  });
});

describe("costDelta", () => {
  it("describes today against yesterday", () => {
    expect(costDelta(4.2, 3.1)).toEqual({ text: "+$1.10 vs yesterday", up: true });
    expect(costDelta(1, 3)).toEqual({ text: "−$2.00 vs yesterday", up: false });
    expect(costDelta(2, 2)).toBeNull();
    expect(costDelta(null, 2)).toBeNull();
  });
});

describe("greeting", () => {
  it.each([
    [6, "Good morning"],
    [13, "Good afternoon"],
    [19, "Good evening"],
    [2, "Working late"],
  ])("%sh → %s", (h, want) => {
    expect(greeting(h)).toBe(want);
  });
});

describe("projectLabel", () => {
  it("shows the folder name of a path", () => {
    expect(projectLabel("C:\\work\\shop")).toBe("shop");
    expect(projectLabel("/home/a/api/")).toBe("api");
    expect(projectLabel("")).toBe("Unknown project");
  });
});

describe("quotaFreshness", () => {
  const now = 1_000_000_000_000;
  it("says how recent the numbers are", () => {
    expect(quotaFreshness(now - 20_000, now)).toBe("Updated just now");
    expect(quotaFreshness(now - 5 * 60_000, now)).toBe("Updated 5m ago");
    expect(quotaFreshness(now - 3 * 3600_000, now)).toBe("Updated 3h ago");
    expect(quotaFreshness(now - 3 * 86_400_000, now)).toBe("Updated 3d ago");
  });
});
