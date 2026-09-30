import { effect, signal } from "@preact/signals";
import type { LiveStatus, Session } from "../features/chats/types";
import type { Environment, HostMsg } from "../shared/protocol";
import { loadViewState, saveViewState } from "./bus";
import type { Filter } from "./chats/model";

export type Tab = "home" | "chats" | "usage" | "setup";

interface Persisted {
  tab: Tab;
  filter: Filter | null;
}

const saved = loadViewState<Persisted>({ tab: "chats", filter: null });

export const tab = signal<Tab>(saved.tab);
/** null = not chosen yet; picks "This folder" when it has chats, else "All". */
export const filter = signal<Filter | null>(saved.filter);
export const query = signal("");

export const loaded = signal(false);
export const error = signal<string | null>(null);
export const sessions = signal<Session[]>([]);
export const live = signal<LiveStatus[]>([]);
export const pins = signal<string[]>([]);
export const renames = signal<Record<string, string>>({});
export const here = signal<string[]>([]);
export const env = signal<Environment | null>(null);

effect(() => {
  saveViewState({ tab: tab.value, filter: filter.value } satisfies Persisted);
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
    case "error":
      error.value = m.text;
      loaded.value = true;
      break;
    case "loading":
      break;
  }
}
