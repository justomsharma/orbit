import { describe, expect, it } from "vitest";
import type { LiveStatus, Session } from "../../../features/chats/types";
import { branchesOf, buildItems, type ChatsInput, projectsOf, relativeTime } from "../model";

const NOW = new Date(2026, 8, 30, 15, 0, 0).getTime(); // Wed 30 Sep 2026, 15:00 local
const H = 3600_000;
const D = 24 * H;

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

const labels = (items: ReturnType<typeof buildItems>) =>
  items.map((i) => (i.kind === "header" ? `# ${i.label}` : i.vm.title));

describe("buildItems", () => {
  it("groups chats by how recently they were active", () => {
    const items = buildItems(
      input([
        s({ title: "a", lastActiveAt: NOW - H }),
        s({ title: "b", lastActiveAt: NOW - 20 * H }),
        s({ title: "c", lastActiveAt: NOW - 3 * D }),
        s({ title: "d", lastActiveAt: NOW - 20 * D }),
        s({ title: "e", lastActiveAt: NOW - 90 * D }),
      ]),
      "",
      "all",
      NOW,
    );
    expect(labels(items)).toEqual([
      "# Today",
      "a",
      "# Yesterday",
      "b",
      "# Previous 7 days",
      "c",
      "# Previous 30 days",
      "d",
      "# Older",
      "e",
    ]);
  });

  it("puts running chats first, then pinned, each chat only once", () => {
    const live = s({ title: "live" });
    const pinned = s({ title: "pinned" });
    const both = s({ title: "both" });
    const plain = s({ title: "plain" });
    const status: LiveStatus[] = [live, both].map((x) => ({
      sessionId: x.id,
      pid: 1,
      status: "busy",
      name: null,
      updatedAt: 0,
    }));
    const items = buildItems(
      input([plain, pinned, both, live], { live: status, pins: [pinned.id, both.id] }),
      "",
      "all",
      NOW,
    );
    expect(labels(items)).toEqual([
      "# Running now",
      "both",
      "live",
      "# Pinned",
      "pinned",
      "# Today",
      "plain",
    ]);
  });

  it("uses Orbit renames as the title", () => {
    const a = s({ title: "Original" });
    const items = buildItems(input([a], { renames: { [a.id]: "Renamed" } }), "", "all", NOW);
    expect(labels(items)).toEqual(["# Today", "Renamed"]);
  });

  it("searches title, first prompt, project and branch; every word must match", () => {
    const list = [
      s({ title: "Fix login", project: "shop", branch: "main" }),
      s({ title: "Refactor", firstPrompt: "clean up the LOGIN form", project: "api" }),
      s({ title: "Docs", branch: "feature/login-page" }),
      s({ title: "Other" }),
    ];
    expect(
      labels(buildItems(input(list), "login", "all", NOW)).filter((l) => !l.startsWith("#")),
    ).toEqual(["Fix login", "Refactor", "Docs"]);
    expect(labels(buildItems(input(list), "login api", "all", NOW))).toEqual([
      "# Today",
      "Refactor",
    ]);
  });

  it("filters to this folder, pinned, or running", () => {
    const here = s({ title: "here" });
    const away = s({ title: "away" });
    const base = input([here, away], {
      here: [here.id],
      pins: [away.id],
      live: [{ sessionId: here.id, pid: 1, status: "idle", name: null, updatedAt: 0 }],
    });
    const chats = (f: Parameters<typeof buildItems>[2]) =>
      labels(buildItems(base, "", f, NOW)).filter((l) => !l.startsWith("#"));
    expect(chats("workspace")).toEqual(["here"]);
    expect(chats("pinned")).toEqual(["away"]);
    expect(chats("live")).toEqual(["here"]);
    expect(chats("all")).toEqual(["here", "away"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(buildItems(input([s()]), "zzz", "all", NOW)).toEqual([]);
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

describe("buildItems: tags and narrowing", () => {
  it("finds chats by #tag and shows tags to plain search too", () => {
    const a = s({ title: "Alpha" });
    const b = s({ title: "Beta" });
    const i = input([a, b], { tags: { [a.id]: ["release", "bug"] } });
    expect(labels(buildItems(i, "#bug", "all", NOW)).filter((l) => !l.startsWith("#"))).toEqual([
      "Alpha",
    ]);
    expect(labels(buildItems(i, "#bu", "all", NOW)).filter((l) => !l.startsWith("#"))).toEqual([]);
    expect(labels(buildItems(i, "release", "all", NOW)).filter((l) => !l.startsWith("#"))).toEqual([
      "Alpha",
    ]);
    const vm = buildItems(i, "", "all", NOW).find((x) => x.kind === "chat" && x.vm.s.id === a.id);
    expect(vm?.kind === "chat" && vm.vm.tags).toEqual(["release", "bug"]);
  });

  it("narrows by project folder, branch and date", () => {
    const shopMain = s({ title: "Shop main", cwd: "/code/shop", branch: "main" });
    const shopFix = s({
      title: "Shop fix",
      cwd: "/code/shop",
      branch: "fix/cart",
      lastActiveAt: NOW - 3 * D,
    });
    const api = s({ title: "Api", cwd: "/code/api", project: "api", lastActiveAt: NOW - 40 * D });
    const i = input([shopMain, shopFix, api]);
    const titles = (more: Parameters<typeof buildItems>[4]) =>
      labels(buildItems(i, "", "all", NOW, more)).filter((l) => !l.startsWith("#"));
    expect(titles({ project: "/code/shop" })).toEqual(["Shop main", "Shop fix"]);
    expect(titles({ project: "/code/shop", branch: "fix/cart" })).toEqual(["Shop fix"]);
    expect(titles({ since: "today" })).toEqual(["Shop main"]);
    expect(titles({ since: "week" })).toEqual(["Shop main", "Shop fix"]);
    expect(titles({ since: "month" })).toEqual(["Shop main", "Shop fix"]);
    expect(titles({})).toEqual(["Shop main", "Shop fix", "Api"]);
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
