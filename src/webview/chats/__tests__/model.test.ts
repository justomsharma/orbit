import { describe, expect, it } from "vitest";
import type { LiveStatus, Session } from "../../../features/chats/types";
import {
  branchesOf,
  buildItems,
  type ChatFilter,
  type ChatsInput,
  DEFAULT_FILTER,
  dateGroup,
  duration,
  facets,
  projectsOf,
  RECENT,
  relativeTime,
  visible,
} from "../model";

const NOW = new Date(2026, 8, 30, 15, 0, 0).getTime(); // Wed 30 Sep 2026, 15:00 local
const H = 3600_000;
const D = 24 * H;
const ALL: ChatFilter = { ...DEFAULT_FILTER, date: "all" };

let n = 0;
function s(over: Partial<Session> = {}): Session {
  n++;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    file: `/p/${id}.jsonl`,
    cwd: "/code/shop",
    project: "shop",
    title: `Chat ${n}`,
    firstPrompt: "",
    branch: "main",
    startedAt: NOW - H,
    lastActiveAt: NOW - H,
    prompts: 1,
    estimated: false,
    model: null,
    entrypoint: "cli",
    prLinks: [],
    continuedIn: null,
    sizeBytes: 1,
    ...over,
  };
}

function input(sessions: Session[], over: Partial<ChatsInput> = {}): ChatsInput {
  return {
    sessions,
    live: [],
    pins: [],
    renames: {},
    tags: {},
    here: sessions.map((x) => x.id),
    ...over,
  };
}

const live = (x: Session): LiveStatus => ({
  sessionId: x.id,
  pid: 1,
  status: "busy",
  name: null,
  updatedAt: NOW,
});

const labels = (items: ReturnType<typeof buildItems>) =>
  items.map((i) => (i.kind === "header" ? `# ${i.label}` : i.vm.title));

describe("dateGroup", () => {
  it("names days, then week ranges, then months", () => {
    expect(dateGroup(NOW - H, NOW)).toBe("Today");
    expect(dateGroup(NOW - D, NOW)).toBe("Yesterday");
    expect(dateGroup(NOW - 3 * D, NOW)).toMatch(/Sun.*Sep.*27|27.*Sep.*Sun/);
    expect(dateGroup(NOW - 8 * D, NOW)).toMatch(/Sep 17 – Sep 23|17 Sep – 23 Sep/);
    expect(dateGroup(new Date(2026, 6, 4).getTime(), NOW)).toMatch(/July 2026/);
  });
});

describe("buildItems", () => {
  it("puts running chats first, then today, then pinned, then by date, each chat once", () => {
    const a = s({ title: "Running", lastActiveAt: NOW - 3 * D });
    const b = s({ title: "Today", lastActiveAt: NOW - H });
    const c = s({ title: "Pinned old", lastActiveAt: NOW - 20 * D });
    const d = s({ title: "Yesterday", lastActiveAt: NOW - D });
    const items = buildItems(input([a, b, c, d], { live: [live(a)], pins: [c.id] }), "", ALL, NOW);
    expect(labels(items)).toEqual([
      "# Running now",
      "Running",
      "# Today",
      "Today",
      "# Pinned",
      "Pinned old",
      "# Yesterday",
      "Yesterday",
    ]);
  });

  it("keeps a collapsed group's header and count, without its chats", () => {
    const a = s({ title: "A" });
    const b = s({ title: "B" });
    const items = buildItems(input([a, b]), "", ALL, NOW, ["Today"]);
    expect(items).toEqual([
      { kind: "header", key: "h:Today", label: "Today", count: 2, collapsed: true },
    ]);
  });

  it("shows a flat list while searching, over title, prompt, project, branch and #tags", () => {
    const a = s({ title: "Fix cart", branch: "fix/cart" });
    const b = s({ title: "Other", firstPrompt: "the cart again" });
    const c = s({ title: "Tagged" });
    const items = buildItems(input([a, b, c], { tags: { [c.id]: ["bug"] } }), "cart", ALL, NOW);
    expect(labels(items)).toEqual(["Fix cart", "Other"]);
    expect(
      labels(buildItems(input([a, b, c], { tags: { [c.id]: ["bug"] } }), "#bug", ALL, NOW)),
    ).toEqual(["Tagged"]);
  });

  it("uses Orbit renames as the title", () => {
    const a = s();
    expect(labels(buildItems(input([a], { renames: { [a.id]: "Mine" } }), "", ALL, NOW))).toEqual([
      "# Today",
      "Mine",
    ]);
  });
});

describe("filters", () => {
  it("Recent shows pinned and running chats plus the 20 newest, and says how many more there are", () => {
    const many = Array.from({ length: 25 }, (_, i) => s({ lastActiveAt: NOW - i * H }));
    const old = s({ lastActiveAt: NOW - 90 * D });
    const v = visible(input([...many, old], { pins: [old.id] }), "", DEFAULT_FILTER, NOW);
    expect(v.list).toHaveLength(RECENT + 1);
    expect(v.more).toBe(5);
    // Searching always looks at every chat.
    expect(visible(input(many), "chat", DEFAULT_FILTER, NOW).more).toBe(0);
  });

  it("Week and Month go back 7 or 30 days, keeping pinned chats", () => {
    const a = s({ lastActiveAt: NOW - 3 * D });
    const b = s({ lastActiveAt: NOW - 20 * D });
    const c = s({ lastActiveAt: NOW - 60 * D });
    const i = input([a, b, c], { pins: [c.id] });
    expect(visible(i, "", { ...ALL, date: "week" }, NOW).list.map((x) => x.s.id)).toEqual([
      a.id,
      c.id,
    ]);
    expect(visible(i, "", { ...ALL, date: "month" }, NOW).list).toHaveLength(3);
  });

  it("narrows by folder, branch (including no branch) and worktree", () => {
    const a = s({ cwd: "/code/api", project: "api" });
    const b = s({ branch: null });
    const c = s({ worktree: { kind: "claude", name: "fix", removed: false } });
    const i = input([a, b, c], { here: [b.id] });
    expect(visible(i, "", { ...ALL, project: "/code/api" }, NOW).list.map((x) => x.s.id)).toEqual([
      a.id,
    ]);
    expect(visible(i, "", { ...ALL, project: "here" }, NOW).list.map((x) => x.s.id)).toEqual([
      b.id,
    ]);
    expect(visible(i, "", { ...ALL, branch: "" }, NOW).list.map((x) => x.s.id)).toEqual([b.id]);
    expect(visible(i, "", { ...ALL, worktree: "claude" }, NOW).list.map((x) => x.s.id)).toEqual([
      c.id,
    ]);
  });

  it("keeps archived and hidden chats out of the list, each in a view of its own", () => {
    const a = s();
    const b = s();
    const c = s();
    const i = input([a, b, c], { archived: [b.id], hidden: [c.id] });
    expect(visible(i, "", ALL, NOW).list.map((x) => x.s.id)).toEqual([a.id]);
    expect(visible(i, "", { ...ALL, view: "archived" }, NOW).list.map((x) => x.s.id)).toEqual([
      b.id,
    ]);
    expect(visible(i, "", { ...ALL, view: "hidden" }, NOW).list.map((x) => x.s.id)).toEqual([c.id]);
  });

  it("counts each menu's options with the other filters applied", () => {
    const a = s({ cwd: "/code/api", project: "api", branch: "dev" });
    const b = s({ branch: "main" });
    const c = s({ branch: "main" });
    const f = facets(input([a, b, c], { here: [b.id] }), { ...ALL, branch: "main" }, NOW);
    expect(f.projects.find((p) => p.value === "/code/shop")?.count).toBe(2);
    expect(f.projects.find((p) => p.value === "/code/api")?.count).toBe(0);
    expect(f.projects.find((p) => p.value === "here")?.count).toBe(1);
    expect(f.branches.map((x) => [x.label, x.count])).toEqual([
      ["All branches", 3],
      ["main", 2],
      ["dev", 1],
    ]);
    expect(f.hasWorktrees).toBe(false);
  });
});

describe("relativeTime", () => {
  it.each([
    [NOW - 20_000, "just now"],
    [NOW - 5 * 60_000, "5m ago"],
    [NOW - 3 * H, "3h ago"],
    [NOW - 20 * H, "Yesterday"],
    [NOW - 3 * D, "Sun"],
    [new Date(2026, 5, 2).getTime(), "Jun 2"],
    [new Date(2025, 11, 25).getTime(), "Dec 25, 2025"],
  ])("formats %s as %s", (t, want) => {
    expect(relativeTime(t, NOW, "en-US")).toBe(want);
  });
});

describe("duration", () => {
  it.each([
    [20_000, "<1m"],
    [30 * 60_000, "30m"],
    [145 * 60_000, "2h 25m"],
    [(13 * 24 + 16) * H, "13d 16h"],
  ])("formats %s as %s", (ms, want) => {
    expect(duration(ms)).toBe(want);
  });
});

describe("projectsOf / branchesOf", () => {
  it("lists folders by name, newest first, telling apart folders with the same name", () => {
    const a = s({ cwd: "/work/shop", project: "shop", lastActiveAt: NOW - H });
    const b = s({ cwd: "/home/shop", project: "shop", lastActiveAt: NOW - 2 * H });
    const c = s({ cwd: "/code/api", project: "api", lastActiveAt: NOW - 3 * H });
    expect(projectsOf([a, b, c, a])).toEqual([
      { cwd: "/work/shop", label: "shop (/work/shop)" },
      { cwd: "/home/shop", label: "shop (/home/shop)" },
      { cwd: "/code/api", label: "api" },
    ]);
    expect(branchesOf([a, s({ cwd: "/work/shop", branch: "dev" }), c], "/work/shop")).toEqual([
      "dev",
      "main",
    ]);
  });
});
