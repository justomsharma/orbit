import { effect, signal } from "@preact/signals";
import type { SetupSnapshot } from "../extension/setupService";
import type { UsageSnapshot } from "../extension/usageService";
import type { MessageHit } from "../features/chats/search";
import type { LiveStatus, Session } from "../features/chats/types";
import type { PromptEntry } from "../features/prompts/library";
import type { SettingDef } from "../features/setup/catalog";
import type { ChangedFileView, Environment, HostMsg } from "../shared/protocol";
import { loadViewState, saveViewState } from "./bus";
import type { Filter } from "./chats/model";

export type Tab = "home" | "chats" | "usage" | "setup";

export type Range = "today" | "week" | "month" | "all";

interface Persisted {
  tab: Tab;
  filter: Filter | null;
  range: Range;
  chatsMode?: "chats" | "prompts";
}

const saved = loadViewState<Persisted>({ tab: "home", filter: null, range: "month" });

export const tab = signal<Tab>(saved.tab);
/** null = not chosen yet; picks "This folder" when it has chats, else "All". */
export const filter = signal<Filter | null>(saved.filter);
export const query = signal("");
export const range = signal<Range>(saved.range);
export const usage = signal<UsageSnapshot | null>(null);
export const setup = signal<SetupSnapshot | null>(null);
export const catalog = signal<SettingDef[]>([]);
/** Setup search text and which sections are open. */
export const setupQuery = signal("");
export const openSections = signal<string[]>(["health"]);
/** The Chats tab shows chats or the prompt library. */
export const chatsMode = signal<"chats" | "prompts">(saved.chatsMode ?? "chats");
/** The chat whose files and transcript are open; `files` null until the host answers. */
export const details = signal<{ id: string; files: ChangedFileView[] | null } | null>(null);
/** Put focus back in the chat search box when the list shows again. */
export const focusSearch = signal(false);
/** Prompt library; null until the host has read the history. */
export const prompts = signal<PromptEntry[] | null>(null);
export const promptsError = signal<string | null>(null);
export const promptQuery = signal("");
/** Search inside messages, and the answer to the latest search only. */
export const inMessages = signal(false);
/** The search in flight: its id, text, and which chats it covers. */
export const messageSearch = signal<{ req: string; query: string; key: string } | null>(null);
export const messageHits = signal<{
  req: string;
  hits: MessageHit[];
  done: boolean;
  searched?: number;
  total?: number;
  capped?: boolean;
} | null>(null);

/** Host replies to Setup forms: request id → whether the change was made. */
export const results = signal<Record<string, boolean>>({});
/** Ticks every minute so "Updated 2m ago" and "Resets in 1h" stay true while idle. */
export const now = signal(Date.now());
if (typeof window !== "undefined") setInterval(() => (now.value = Date.now()), 60_000);

export const loaded = signal(false);
export const error = signal<string | null>(null);
export const sessions = signal<Session[]>([]);
export const live = signal<LiveStatus[]>([]);
export const pins = signal<string[]>([]);
export const renames = signal<Record<string, string>>({});
export const tags = signal<Record<string, string[]>>({});
/** The filter menus: a chat folder, a branch in it, and how recent. */
export const narrow = signal<{
  project: string | null;
  branch: string | null;
  since: "today" | "week" | "month" | null;
}>({ project: null, branch: null, since: null });
export const here = signal<string[]>([]);
export const env = signal<Environment | null>(null);

effect(() => {
  saveViewState({
    tab: tab.value,
    filter: filter.value,
    range: range.value,
    chatsMode: chatsMode.value,
  } satisfies Persisted);
});

export function applyHostMessage(m: HostMsg): void {
  switch (m.type) {
    case "sessions":
      sessions.value = m.items;
      live.value = m.live;
      pins.value = m.pins;
      renames.value = m.renames;
      tags.value = m.tags;
      here.value = m.here;
      env.value = m.env;
      error.value = null;
      loaded.value = true;
      break;
    case "usage":
      usage.value = m.data;
      break;
    case "setup":
      setup.value = m.data;
      break;
    case "catalog":
      catalog.value = m.data;
      break;
    case "chat:details":
      if (details.value?.id === m.id) details.value = { id: m.id, files: m.files };
      break;
    case "prompts":
      prompts.value = m.items;
      promptsError.value = m.error ?? null;
      break;
    case "search":
      if (messageSearch.value?.req === m.req) messageHits.value = m;
      break;
    case "setup:result":
      results.value = { ...results.value, [m.req]: m.ok };
      break;
    case "error":
      error.value = m.text;
      loaded.value = true;
      break;
    case "loading":
      break;
  }
}
