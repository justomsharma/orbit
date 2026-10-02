import type { LiveStatus, Session } from "../../features/chats/types";

/** How recent: pinned chats plus the 20 newest, the last 7 or 30 days, or every chat. */
export type DateFilter = "recent" | "week" | "month" | "all";
/** Where a chat ran: the main checkout, a worktree Claude made, or one you made. */
export type WorktreeFilter = "all" | "main" | "claude" | "user";
/** The normal list, the archive, or chats you hid. */
export type ChatsView = "chats" | "archived" | "hidden";

export interface ChatFilter {
  date: DateFilter;
  /** "all", "here" (folders open in this window) or one chat folder (cwd). */
  project: string;
  /** null: any branch; "": chats with no branch. */
  branch: string | null;
  worktree: WorktreeFilter;
  view: ChatsView;
}

export const DEFAULT_FILTER: ChatFilter = {
  date: "recent",
  project: "all",
  branch: null,
  worktree: "all",
  view: "chats",
};

const ALL_OF_VIEW: ChatFilter = {
  date: "all",
  project: "all",
  branch: null,
  worktree: "all",
  view: "chats",
};

/** How many unpinned chats "Recent" shows. */
export const RECENT = 20;

export interface ChatsInput {
  sessions: Session[];
  live: LiveStatus[];
  pins: string[];
  renames: Record<string, string>;
  /** Ids of chats that belong to the folder open in this window. */
  here: string[];
  /** Orbit-only tags per chat. */
  tags?: Record<string, string[]>;
  archived?: string[];
  hidden?: string[];
  temp?: string[];
  /** Running chats whose terminal Orbit can show. */
  terminals?: string[];
}

export interface ChatVM {
  s: Session;
  title: string;
  live: LiveStatus | undefined;
  pinned: boolean;
  here: boolean;
  tags: string[];
  temp: boolean;
  archived: boolean;
  hidden: boolean;
  /** Its terminal is open in this window. */
  linked: boolean;
}

export type Item =
  | { kind: "header"; key: string; label: string; count: number; collapsed: boolean }
  | { kind: "chat"; key: string; vm: ChatVM };

const DAY = 24 * 3600_000;

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const daysAgo = (t: number, now: number) => Math.round((startOfDay(now) - startOfDay(t)) / DAY);

const short = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * The date group a chat falls in: Today, Yesterday, the weekday ("Mon, Sep 8")
 * for the rest of the week, week ranges ("Sep 1 – Sep 7") for the month, then months.
 */
export function dateGroup(t: number, now: number): string {
  const n = daysAgo(t, now);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n <= 6)
    return new Date(t).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  if (n <= 34) {
    const k = Math.floor((n - 7) / 7);
    const end = startOfDay(now) - (7 + 7 * k) * DAY;
    const start = end - 6 * DAY;
    return `${short(start)} – ${short(end)}`;
  }
  return new Date(t).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export const RUNNING = "Running now";
export const PINNED = "Pinned";

function matches(vm: ChatVM, words: string[]): boolean {
  if (!words.length) return true;
  const hay =
    `${vm.title} ${vm.s.firstPrompt} ${vm.s.project} ${vm.s.branch ?? ""} ${vm.s.worktree?.name ?? ""} ${vm.tags.join(" ")}`.toLowerCase();
  // "#tag" matches a whole tag; other words match anywhere.
  return words.every((w) =>
    w.startsWith("#") && w.length > 1 ? vm.tags.includes(w.slice(1)) : hay.includes(w),
  );
}

/** Every chat as the list sees it, newest first. */
export function toVMs(input: ChatsInput): ChatVM[] {
  const live = new Map(input.live.map((l) => [l.sessionId, l]));
  const set = (xs?: string[]) => new Set(xs ?? []);
  const pins = set(input.pins);
  const here = set(input.here);
  const archived = set(input.archived);
  const hidden = set(input.hidden);
  const temp = set(input.temp);
  const linked = set(input.terminals);
  return [...input.sessions]
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map((s) => ({
      s,
      title: input.renames[s.id] ?? s.title,
      live: live.get(s.id),
      pinned: pins.has(s.id),
      here: here.has(s.id),
      tags: input.tags?.[s.id] ?? [],
      temp: temp.has(s.id),
      archived: archived.has(s.id),
      hidden: hidden.has(s.id),
      linked: linked.has(s.id),
    }));
}

type Dim = "date" | "project" | "branch" | "worktree";

/** Applies every filter except `skip` (for "faceted" counts in each menu). */
function keep(vm: ChatVM, f: ChatFilter, now: number, skip?: Dim): boolean {
  if (
    f.view === "archived"
      ? !vm.archived
      : f.view === "hidden"
        ? !vm.hidden
        : vm.archived || vm.hidden
  )
    return false;
  if (skip !== "project" && f.project !== "all") {
    if (f.project === "here" ? !vm.here : vm.s.cwd !== f.project) return false;
  }
  if (skip !== "branch" && f.branch !== null && (vm.s.branch ?? "") !== f.branch) return false;
  if (skip !== "worktree" && f.worktree !== "all") {
    const kind = vm.s.worktree?.kind ?? "main";
    if (kind !== f.worktree) return false;
  }
  if (skip !== "date" && (f.date === "week" || f.date === "month") && !vm.pinned && !vm.live) {
    const since = startOfDay(now) - (f.date === "week" ? 6 : 29) * DAY;
    if (vm.s.lastActiveAt < since) return false;
  }
  return true;
}

/** "Recent": running and pinned chats plus the 20 newest others. */
function recentOnly(list: ChatVM[]): ChatVM[] {
  let others = 0;
  return list.filter((vm) => vm.pinned || vm.live || others++ < RECENT);
}

/** The chats the filters and search leave, newest first, and how many "Recent" held back. */
export function visible(
  input: ChatsInput,
  query: string,
  f: ChatFilter,
  now: number,
): { list: ChatVM[]; more: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = toVMs(input).filter((vm) => keep(vm, f, now) && matches(vm, words));
  if (f.date !== "recent" || words.length) return { list: all, more: 0 };
  const list = recentOnly(all);
  return { list, more: all.length - list.length };
}

/**
 * The flat list the Chats view renders: group headers followed by their chats.
 * Running chats come first, then Today, then pinned, then by date. Searching shows
 * one flat list. Collapsed groups keep their header and count.
 */
export function buildItems(
  input: ChatsInput,
  query: string,
  f: ChatFilter,
  now: number,
  collapsed: string[] = [],
): Item[] {
  const { list } = visible(input, query, f, now);
  if (query.trim()) return list.map((vm) => ({ kind: "chat", key: vm.s.id, vm }));
  const groups = new Map<string, ChatVM[]>();
  const order: string[] = [RUNNING, "Today", PINNED];
  for (const vm of list) {
    const day = dateGroup(vm.s.lastActiveAt, now);
    const g = vm.live ? RUNNING : day === "Today" ? "Today" : vm.pinned ? PINNED : day;
    if (!order.includes(g)) order.push(g);
    const cur = groups.get(g);
    if (cur) cur.push(vm);
    else groups.set(g, [vm]);
  }
  const shut = new Set(collapsed);
  const out: Item[] = [];
  for (const label of order) {
    const rows = groups.get(label);
    if (!rows) continue;
    const c = shut.has(label);
    out.push({ kind: "header", key: `h:${label}`, label, count: rows.length, collapsed: c });
    if (!c) for (const vm of rows) out.push({ kind: "chat", key: vm.s.id, vm });
  }
  return out;
}

export interface Facet<T extends string = string> {
  value: T;
  label: string;
  count: number;
}

/** The options of each filter menu, with how many chats each would show. */
export function facets(input: ChatsInput, f: ChatFilter, now: number) {
  const vms = toVMs(input);
  const by = (skip: Dim) => vms.filter((vm) => keep(vm, f, now, skip));
  const inProject = by("project");
  const projects: Facet[] = [
    { value: "here", label: "This folder", count: inProject.filter((vm) => vm.here).length },
    { value: "all", label: "All folders", count: inProject.length },
    // Every folder in this view is offered, even ones the other filters leave empty.
    ...projectsOf(
      vms.filter((vm) => keep(vm, { ...ALL_OF_VIEW, view: f.view }, now)).map((vm) => vm.s),
    ).map((p) => ({
      value: p.cwd,
      label: p.label,
      count: inProject.filter((vm) => vm.s.cwd === p.cwd).length,
    })),
  ];
  const inBranch = by("branch");
  const branchCount = new Map<string, number>();
  for (const vm of inBranch) {
    const b = vm.s.branch ?? "";
    branchCount.set(b, (branchCount.get(b) ?? 0) + 1);
  }
  const branches: Facet[] = [
    { value: "*", label: "All branches", count: inBranch.length },
    ...[...branchCount]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([b, count]) => ({ value: b, label: b || "(no branch)", count })),
  ];
  const inWorktree = by("worktree");
  const wt = (k: WorktreeFilter) =>
    inWorktree.filter((vm) => (vm.s.worktree?.kind ?? "main") === k).length;
  const worktrees: Facet<WorktreeFilter>[] = [
    { value: "all", label: "All checkouts", count: inWorktree.length },
    { value: "main", label: "Main checkout", count: wt("main") },
    { value: "claude", label: "Claude's worktrees", count: wt("claude") },
    { value: "user", label: "Your worktrees", count: wt("user") },
  ];
  return {
    projects,
    branches,
    worktrees: worktrees.filter((w) => w.value === "all" || w.value === "main" || w.count > 0),
    hasWorktrees: wt("claude") + wt("user") > 0,
  };
}

/** Short, friendly time: "just now", "5m ago", "3h ago", "Yesterday", "Mon", "Jun 2", "Dec 25, 2025". */
export function relativeTime(t: number, now: number, locale?: string): string {
  const diff = now - t;
  if (diff < 60_000) return "just now";
  const today = startOfDay(now);
  if (t >= today || diff < 3600_000) {
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    return `${Math.floor(diff / 3600_000)}h ago`;
  }
  if (t >= today - DAY) return "Yesterday";
  const d = new Date(t);
  if (t >= today - 6 * DAY) return d.toLocaleDateString(locale, { weekday: "short" });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "Sep 8, 3:04 PM" */
export const exactTime = (t: number) =>
  new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** "<1m", "30m", "2h 25m", "13d 16h" */
export function duration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Chat folders for the project menu, most recently used first. Same-named folders show their path. */
export function projectsOf(sessions: Session[]): { cwd: string; label: string }[] {
  const latest = new Map<string, Session>();
  for (const s of sessions) {
    const cur = latest.get(s.cwd);
    if (!cur || s.lastActiveAt > cur.lastActiveAt) latest.set(s.cwd, s);
  }
  const list = [...latest.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const names = new Map<string, number>();
  for (const s of list) names.set(s.project, (names.get(s.project) ?? 0) + 1);
  return list.map((s) => ({
    cwd: s.cwd,
    label: (names.get(s.project) ?? 0) > 1 ? `${s.project} (${s.cwd})` : s.project,
  }));
}

/** Branches seen in one folder's chats, alphabetically. */
export function branchesOf(sessions: Session[], cwd: string): string[] {
  const set = new Set<string>();
  for (const s of sessions) if (s.cwd === cwd && s.branch) set.add(s.branch);
  return [...set].sort((a, b) => a.localeCompare(b));
}
