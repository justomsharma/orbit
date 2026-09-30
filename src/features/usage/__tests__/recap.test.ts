import { describe, expect, it } from "vitest";
import type { Session } from "../../chats/types";
import { recapMarkdown, weeklyRecap } from "../recap";
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

const session = (lastActiveAt: number, over: Partial<Session> = {}): Session => ({
  id: `sess-${n++}`,
  file: "/home/me/.claude/projects/x/y.jsonl",
  cwd: "/w/shop",
  project: "shop",
  title: "A chat",
  firstPrompt: "hi",
  branch: null,
  startedAt: lastActiveAt,
  lastActiveAt,
  prompts: 1,
  estimated: false,
  model: "claude-opus-5-5",
  entrypoint: "cli",
  prLinks: [],
  continuedIn: null,
  sizeBytes: 100,
  ...over,
});

const local = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();
// Wednesday 30 September 2026, 3 pm local. The week is Thu 24 → Wed 30.
const NOW = local(9, 30, 15);
const M = 1_000_000;

describe("weeklyRecap", () => {
  it("covers the last seven local days including today", () => {
    const r = weeklyRecap([], [], NOW);
    expect(r.from).toBe(new Date(2026, 8, 24).getTime());
    expect(r.to).toBe(new Date(2026, 9, 1).getTime());
  });

  it("adds up chats, prompts, cost, tokens and active days", () => {
    const records = [
      rec(local(9, 23, 23), { input: 50 * M }), // the day before the week
      rec(local(9, 24, 0), { input: M, session: "a" }),
      rec(local(9, 29, 9), { output: M, cacheRead: M, session: "b", model: "claude-sonnet-5" }),
      rec(local(9, 29, 18), { input: 2 * M, session: "b", model: "claude-sonnet-5" }),
    ];
    const sessions = [
      session(local(9, 20), { prompts: 99 }), // last active before the week
      session(local(9, 24), { prompts: 3 }),
      session(local(9, 27), { prompts: 4, project: "blog", cwd: "/w/blog" }),
      session(local(9, 30, 14), { prompts: 5 }),
    ];
    const r = weeklyRecap(records, sessions, NOW);
    expect(r.chats).toBe(3);
    expect(r.prompts).toBe(12);
    expect(r.tokens).toBe(5 * M);
    expect(r.cost).toBeCloseTo(4 + 10 + 0.2 + 4);
    // Usage on the 24th and 29th, chats on the 24th, 27th and 30th.
    expect(r.activeDays).toBe(4);
    expect(r.busiestDay).toBe("Tuesday");
    expect(r.models).toEqual(["claude-sonnet-5", "claude-opus-5-5"]);
  });

  it("lists the top three projects by chat count", () => {
    const at = local(9, 28);
    const mk = (project: string, count: number) =>
      Array.from({ length: count }, () => session(at, { project, cwd: `/w/${project}` }));
    const r = weeklyRecap([], [...mk("a", 1), ...mk("b", 4), ...mk("c", 2), ...mk("d", 2)], NOW);
    expect(r.topProjects).toEqual([
      { name: "b", chats: 4 },
      { name: "c", chats: 2 },
      { name: "d", chats: 2 },
    ]);
  });

  it("lists each pull request once", () => {
    const at = local(9, 28);
    const pr1 = "https://github.com/acme/shop/pull/1";
    const pr2 = "https://github.com/acme/shop/pull/2";
    const r = weeklyRecap(
      [],
      [
        session(at, { prLinks: [pr1] }),
        session(at, { prLinks: [pr1, pr2] }),
        session(local(9, 1), { prLinks: ["https://github.com/acme/shop/pull/0"] }),
      ],
      NOW,
    );
    expect(r.prs).toEqual([pr1, pr2]);
  });

  it("describes an empty week", () => {
    expect(
      weeklyRecap([rec(local(9, 1), { input: 5 })], [session(local(9, 1))], NOW),
    ).toMatchObject({
      chats: 0,
      prompts: 0,
      tokens: 0,
      activeDays: 0,
      busiestDay: null,
      topProjects: [],
      prs: [],
      models: [],
    });
  });

  it("has no cost when only unpriced models were used", () => {
    const r = weeklyRecap([rec(local(9, 29), { model: "mystery", input: 5 })], [], NOW);
    expect(r.cost).toBeNull();
    expect(r.tokens).toBe(5);
  });
});

describe("recapMarkdown", () => {
  const base = weeklyRecap([], [], NOW);

  it("reads like a short, shareable note", () => {
    const md = recapMarkdown({
      ...base,
      chats: 12,
      prompts: 87,
      cost: 12.3449,
      tokens: 1_234_567,
      activeDays: 5,
      busiestDay: "Tuesday",
      topProjects: [
        { name: "shop", chats: 5 },
        { name: "orbit", chats: 3 },
      ],
      prs: ["https://github.com/acme/shop/pull/1", "https://github.com/acme/shop/pull/2"],
      models: ["claude-opus-5-5", "claude-opus-5-5[1m]", "claude-sonnet-5"],
    });
    expect(md).toContain("Sep 24 – Sep 30");
    expect(md).toContain("12 chats");
    expect(md).toContain("87 prompts");
    expect(md).toContain("5 active days");
    expect(md).toContain("1.2M tokens");
    expect(md).toContain("$12.34");
    expect(md).toContain("Tuesday");
    expect(md).toContain("shop (5), orbit (3)");
    expect(md).toContain("Opus 5.5, Sonnet 5");
    expect(md).toContain("2 pull requests");
    expect(md).not.toMatch(/[\\/]w[\\/]|\.jsonl|github\.com/);
    expect(md.split("\n").length).toBeLessThan(12);
  });

  it("uses singular words for one of a thing", () => {
    const md = recapMarkdown({
      ...base,
      chats: 1,
      prompts: 1,
      activeDays: 1,
      tokens: 999,
      cost: 0.5,
      prs: ["x"],
      topProjects: [{ name: "shop", chats: 1 }],
    });
    expect(md).toContain("1 chat,");
    expect(md).toContain("1 prompt,");
    expect(md).toContain("1 active day");
    expect(md).toContain("999 tokens");
    expect(md).toContain("1 pull request");
    expect(md).not.toContain("1 pull requests");
  });

  it("omits the cost when it is unknown", () => {
    const md = recapMarkdown({
      ...base,
      chats: 2,
      prompts: 3,
      tokens: 5000,
      cost: null,
      activeDays: 1,
    });
    expect(md).not.toContain("$");
    expect(md).toContain("5K tokens");
  });

  it("says so kindly when the week was quiet", () => {
    const md = recapMarkdown(base);
    expect(md).toContain("Sep 24 – Sep 30");
    expect(md.toLowerCase()).toContain("quiet week");
    expect(md).not.toContain("0 chats");
  });
});
