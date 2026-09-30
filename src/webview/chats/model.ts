import type { LiveStatus, Session } from "../../features/chats/types";

export type Filter = "workspace" | "all" | "pinned" | "live";

export interface ChatsInput {
  sessions: Session[];
  live: LiveStatus[];
  pins: string[];
  renames: Record<string, string>;
  /** Ids of chats that belong to the folder open in this window. */
  here: string[];
  /** Orbit-only tags per chat. */
  tags?: Record<string, string[]>;
}

/** Extra narrowing from the filter menus. `project` is a chat folder (cwd). */
export interface Narrow {
  project?: string | null;
  branch?: string | null;
  since?: "today" | "week" | "month" | null;
}

export interface ChatVM {
  s: Session;
  title: string;
  live: LiveStatus | undefined;
  pinned: boolean;
  here: boolean;
  tags: string[];
}

export type Item =
  | { kind: "header"; key: string; label: string; count: number }
  | { kind: "chat"; key: string; vm: ChatVM };

const DAY = 24 * 3600_000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dateGroup(t: number, now: number): string {
  const today = startOfDay(now);
  if (t >= today) return "Today";
  if (t >= today - DAY) return "Yesterday";
  if (t >= today - 6 * DAY) return "Previous 7 days";
  if (t >= today - 29 * DAY) return "Previous 30 days";
  return "Older";
}

const ORDER = [
  "Running now",
  "Pinned",
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
];

function matches(vm: ChatVM, words: string[]): boolean {
  if (!words.length) return true;
  const hay =
    `${vm.title} ${vm.s.firstPrompt} ${vm.s.project} ${vm.s.branch ?? ""} ${vm.tags.join(" ")}`.toLowerCase();
  // "#tag" matches a whole tag; other words match anywhere.
  return words.every((w) =>
    w.startsWith("#") && w.length > 1 ? vm.tags.includes(w.slice(1)) : hay.includes(w),
  );
}

/** The flat list the Chats view renders: group headers followed by their chats. */
export function buildItems(
  input: ChatsInput,
  query: string,
  filter: Filter,
  now: number,
  narrow: Narrow = {},
): Item[] {
  const since =
    narrow.since === "today"
      ? startOfDay(now)
      : narrow.since === "week"
        ? startOfDay(now) - 6 * DAY
        : narrow.since === "month"
          ? startOfDay(now) - 29 * DAY
          : null;
  const live = new Map(input.live.map((l) => [l.sessionId, l]));
  const pins = new Set(input.pins);
  const here = new Set(input.here);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  const groups = new Map<string, ChatVM[]>();
  const sorted = [...input.sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  for (const s of sorted) {
    const vm: ChatVM = {
      s,
      title: input.renames[s.id] ?? s.title,
      live: live.get(s.id),
      pinned: pins.has(s.id),
      here: here.has(s.id),
      tags: input.tags?.[s.id] ?? [],
    };
    if (filter === "workspace" && !vm.here) continue;
    if (filter === "pinned" && !vm.pinned) continue;
    if (filter === "live" && !vm.live) continue;
    if (narrow.project && s.cwd !== narrow.project) continue;
    if (narrow.branch && s.branch !== narrow.branch) continue;
    if (since !== null && s.lastActiveAt < since) continue;
    if (!matches(vm, words)) continue;
    const g = vm.live ? "Running now" : vm.pinned ? "Pinned" : dateGroup(s.lastActiveAt, now);
    const list = groups.get(g);
    if (list) list.push(vm);
    else groups.set(g, [vm]);
  }

  const out: Item[] = [];
  for (const label of ORDER) {
    const list = groups.get(label);
    if (!list) continue;
    out.push({ kind: "header", key: `h:${label}`, label, count: list.length });
    for (const vm of list) out.push({ kind: "chat", key: vm.s.id, vm });
  }
  return out;
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
