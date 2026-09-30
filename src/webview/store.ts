import { effect, signal } from "@preact/signals";
import type { UsageSnapshot } from "../extension/usageService";
import type { LiveStatus, Session } from "../features/chats/types";
import type { Environment, HostMsg } from "../shared/protocol";
import { loadViewState, saveViewState } from "./bus";
import type { Filter } from "./chats/model";

export type Tab = "home" | "chats" | "usage" | "setup";

export type Range = "today" | "week" | "month" | "all";

interface Persisted {
  tab: Tab;
  filter: Filter | null;
  range: Range;
}

const saved = loadViewState<Persisted>({ tab: "home", filter: null, range: "month" });

export const tab = signal<Tab>(saved.tab);
/** null = not chosen yet; picks "This folder" when it has chats, else "All". */
export const filter = signal<Filter | null>(saved.filter);
export const query = signal("");
export const range = signal<Range>(saved.range);
export const usage = signal<UsageSnapshot | null>(null);
/** Ticks every minute so "Updated 2m ago" and "Resets in 1h" stay true while idle. */
export const now = signal(Date.now());
if (typeof window !== "undefined") setInterval(() => (now.value = Date.now()), 60_000);

export const loaded = signal(false);
export const error = signal<string | null>(null);
export const sessions = signal<Session[]>([]);
export const live = signal<LiveStatus[]>([]);
export const pins = signal<string[]>([]);
export const renames = signal<Record<string, string>>({});
export const here = signal<string[]>([]);
export const env = signal<Environment | null>(null);

effect(() => {
  saveViewState({ tab: tab.value, filter: filter.value, range: range.value } satisfies Persisted);
});

export function applyHostMessage(m: HostMsg): void {
  switch (m.type) {
    case "sessions":
      sessions.value = m.items;
      live.value = m.live;
      pins.value = m.pins;
      renames.value = m.renames;
      here.value = m.here;
      env.value = m.env;
      error.value = null;
      loaded.value = true;
      break;
    case "usage":
      usage.value = m.data;
      break;
    case "error":
      error.value = m.text;
      loaded.value = true;
      break;
    case "loading":
      break;
  }
}
