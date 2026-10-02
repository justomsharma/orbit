import { describe, expect, it } from "vitest";
import { dayKey, heatmap, longestChat, summarize, totalTokens, yearGrid } from "../aggregate";
import type { UsageRecord } from "../types";

let n = 0;
const rec = (t: number, over: Partial<UsageRecord> = {}): UsageRecord => ({
  id: `msg_${n++}`,
  t,
  model: "claude-opus-5-5",
  session: "s1",
  cwd: "/w/shop",
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  webSearches: 0,
  fast: false,
  usGeo: false,
  ...over,
});
/** Local time, like the person's clock. */
const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();
const M = 1_000_000;

describe("dayKey", () => {
  it("uses the local calendar day", () => {
    expect(dayKey(local(2026, 9, 5, 0, 0))).toBe("2026-09-05");
    expect(dayKey(local(2026, 9, 5, 23, 59))).toBe("2026-09-05");
    expect(dayKey(local(2026, 1, 1, 0, 30))).toBe("2026-01-01");
    expect(dayKey(local(2026, 12, 31, 23, 30))).toBe("2026-12-31");
  });
});

describe("totalTokens", () => {
  it("adds every kind of token", () => {
    expect(
      totalTokens(rec(0, { input: 1, output: 2, cacheRead: 4, cacheWrite5m: 8, cacheWrite1h: 16 })),
    ).toBe(31);
  });
});

describe("summarize", () => {
  const from = local(2026, 9, 1, 0);
  const to = local(2026, 9, 4, 0); // three days: 1st, 2nd, 3rd

  it("adds up tokens, cost, messages and sessions inside [from, to)", () => {
    const recs = [
      rec(from - 1, { input: M }), // just before
      rec(from, { input: M, output: M, session: "a" }), // $24
      rec(local(2026, 9, 3, 23, 59), {
        cacheRead: M,
        cacheWrite5m: M,
        cacheWrite1h: M,
        session: "b",
      }),
      rec(to, { input: M }), // just after (exclusive)
    ];
    const s = summarize(recs, from, to);
    expect(s.range).toEqual({ from, to });
    expect(s.messages).toBe(2);
    expect(s.sessions).toBe(2);
    expect(s.tokens).toEqual({ input: M, output: M, cacheRead: M, cacheWrite: 2 * M });
    expect(s.cost).toBeCloseTo(24 + 0.2 + 5 + 8);
    expect(s.unpricedModels).toEqual([]);
  });

  it("computes the cache hit rate", () => {
    const s = summarize(
      [rec(from, { input: 100, cacheRead: 600, cacheWrite5m: 200, cacheWrite1h: 100 })],
      from,
      to,
    );
    expect(s.cacheHitRate).toBeCloseTo(0.6);
    expect(summarize([], from, to).cacheHitRate).toBe(0);
  });

  it("lists unpriced models and leaves them out of the cost", () => {
    const s = summarize(
      [
        rec(from, { input: M }),
        rec(from, { model: "gpt-5", input: M }),
        rec(from, { model: "gpt-5" }),
      ],
      from,
      to,
    );
    expect(s.cost).toBeCloseTo(4);
    expect(s.unpricedModels).toEqual(["gpt-5"]);
    expect(s.tokens.input).toBe(2 * M);
    expect(s.byModel).toEqual([
      { model: "claude-opus-5-5", cost: expect.closeTo(4), tokens: M },
      { model: "gpt-5", cost: null, tokens: M },
    ]);
  });

  it("has no cost when nothing in range is priced, and zero cost when nothing happened", () => {
    expect(summarize([rec(from, { model: "mystery", input: 5 })], from, to).cost).toBeNull();
    expect(summarize([], from, to).cost).toBe(0);
  });

  it("buckets by local day with empty days filled in", () => {
    const s = summarize(
      [
        rec(local(2026, 9, 1, 0, 1), { input: M }),
        rec(local(2026, 9, 1, 23, 59), { output: 10 }),
        rec(local(2026, 9, 3, 8), { input: 5 }),
      ],
      from,
      to,
    );
    expect(s.daily.map((d) => [d.day, d.tokens])).toEqual([
      ["2026-09-01", M + 10],
      ["2026-09-02", 0],
      ["2026-09-03", 5],
    ]);
    expect(s.daily[0]!.cost).toBeCloseTo(4 + 10 * 20e-6);
    expect(s.daily[1]!.cost).toBe(0);
  });

  it("walks calendar days across daylight-saving changes", () => {
    // Whatever the machine's zone, every calendar day appears exactly once.
    const s = summarize([], local(2026, 3, 1, 0), local(2026, 4, 1, 0));
    expect(s.daily).toHaveLength(31);
    expect(s.daily[0]!.day).toBe("2026-03-01");
    expect(s.daily.at(-1)!.day).toBe("2026-03-31");
    const f = summarize([], local(2026, 10, 1, 0), local(2026, 11, 30, 0));
    expect(new Set(f.daily.map((d) => d.day)).size).toBe(f.daily.length);
    expect(f.daily.at(-1)!.day).toBe("2026-11-29");
  });

  it("starts 'all time' at the first record's day", () => {
    const s = summarize(
      [rec(local(2026, 8, 30, 15), { input: 1 }), rec(local(2026, 9, 1, 9), { input: 2 })],
      0,
      local(2026, 9, 2, 0),
    );
    expect(s.daily.map((d) => d.day)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
    expect(summarize([], 0, local(2026, 9, 2, 0)).daily).toEqual([]);
  });

  it("keeps at most the latest 400 days", () => {
    const s = summarize(
      [rec(local(2024, 1, 1), { input: 1 }), rec(local(2026, 9, 1), { input: 1 })],
      0,
      local(2026, 9, 2, 0),
    );
    expect(s.daily).toHaveLength(400);
    expect(s.daily.at(-1)!.day).toBe("2026-09-01");
    expect(s.tokens.input).toBe(2);
  });

  it("sorts models, projects and sessions by cost, then tokens", () => {
    const recs = [
      rec(from, { model: "claude-haiku-4-5", input: 3 * M, cwd: "/w/a", session: "x" }), // $3
      rec(from, { model: "claude-opus-5-5", input: M, cwd: "/w/b", session: "y" }), // $4
      rec(from, { model: "unknown-2", output: 5, cwd: "/w/c", session: "z" }),
      rec(from, { model: "unknown-1", input: 9 * M, cwd: "/w/d", session: "q" }),
      rec(from, { model: "unknown-2", input: 10, cwd: "/w/d", session: "q" }),
    ];
    const s = summarize(recs, from, to);
    expect(s.byModel.map((m) => m.model)).toEqual([
      "claude-opus-5-5",
      "claude-haiku-4-5",
      "unknown-1",
      "unknown-2",
    ]);
    expect(s.byProject.map((p) => p.cwd)).toEqual(["/w/b", "/w/a", "/w/d", "/w/c"]);
    expect(s.byProject[2]).toEqual({ cwd: "/w/d", cost: 0, tokens: 9 * M + 10 });
    expect(s.topSessions.map((t) => t.session)).toEqual(["y", "x", "q", "z"]);
    expect(s.topSessions[0]).toMatchObject({ session: "y", cwd: "/w/b", tokens: M });
  });

  it("keeps the ten biggest sessions", () => {
    const recs = Array.from({ length: 15 }, (_, i) => rec(from, { session: `s${i}`, input: i }));
    const s = summarize(recs, from, to);
    expect(s.topSessions).toHaveLength(10);
    expect(s.topSessions[0]!.session).toBe("s14");
    expect(s.sessions).toBe(15);
  });
});

describe("heatmap", () => {
  const now = local(2026, 9, 30, 15);

  it("has one entry per day for 26 weeks, oldest first, ending today", () => {
    const h = heatmap([], now);
    expect(h).toHaveLength(26 * 7);
    expect(h.at(-1)!.day).toBe("2026-09-30");
    expect(h[0]!.day).toBe(dayKey(new Date(2026, 8, 30 - 26 * 7 + 1).getTime()));
    expect(new Set(h.map((d) => d.day)).size).toBe(h.length);
  });

  it("adds tokens to the right local day and ignores days outside", () => {
    const h = heatmap(
      [
        rec(local(2026, 9, 29, 0, 0), { input: 5 }),
        rec(local(2026, 9, 29, 23, 59), { output: 6 }),
        rec(local(2026, 9, 30, 0, 0), { cacheRead: 7 }),
        rec(local(2026, 10, 1, 0, 0), { input: 1000 }),
        rec(local(2025, 1, 1), { input: 1000 }),
      ],
      now,
      2,
    );
    expect(h).toHaveLength(14);
    expect(h.at(-2)).toEqual({ day: "2026-09-29", tokens: 11 });
    expect(h.at(-1)).toEqual({ day: "2026-09-30", tokens: 7 });
    expect(h.reduce((a, d) => a + d.tokens, 0)).toBe(18);
  });
});

describe("yearGrid", () => {
  const now = local(2026, 9, 30, 15); // a Wednesday

  it("covers 52 whole weeks from a Monday, ending today", () => {
    const g = yearGrid([], now);
    expect(g).toHaveLength(51 * 7 + 3);
    expect(new Date(`${g[0]!.day}T12:00:00`).getDay()).toBe(1);
    expect(g.at(-1)!.day).toBe("2026-09-30");
  });

  it("counts tokens, replies and chats per day", () => {
    const g = yearGrid(
      [
        rec(local(2026, 9, 29, 9), { input: 5, session: "a" }),
        rec(local(2026, 9, 29, 10), { output: 6, session: "b" }),
        rec(local(2026, 9, 29, 11), { output: 1, session: "a" }),
      ],
      now,
    );
    expect(g.at(-2)).toEqual({ day: "2026-09-29", tokens: 12, messages: 3, sessions: 2 });
  });
});

describe("longestChat", () => {
  it("measures each chat from its first reply to its last", () => {
    const h = 3_600_000;
    const ms = longestChat(
      [
        rec(1000, { session: "a" }),
        rec(1000 + 2 * h, { session: "a" }),
        rec(5000, { session: "b" }),
      ],
      0,
      Number.POSITIVE_INFINITY,
    );
    expect(ms).toBe(2 * h);
  });
});
