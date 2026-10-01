import { effect, signal } from "@preact/signals";
import type { SetupSnapshot } from "../extension/setupService";
import type { UsageSnapshot } from "../extension/usageService";
import type { AccountSnapshot } from "../features/account/accounts";
import type { MessageHit } from "../features/chats/search";
import type { LiveStatus, Session } from "../features/chats/types";
import type { PromptEntry } from "../features/prompts/library";
import type { SettingDef } from "../features/setup/catalog";
import type { CheckpointSummary } from "../features/timeline/summary";
import type { Onboarding } from "../shared/onboarding";
import type { ChangedFileView, Environment, HostMsg } from "../shared/protocol";
import { isTab, type Tab } from "../shared/tabs";
import { loadViewState, saveViewState } from "./bus";
import type { Filter } from "./chats/model";

export type { Tab } from "../shared/tabs";

export type Range = "today" | "week" | "month" | "all";

interface Persisted {
  tab: Tab;
  filter: Filter | null;
  range: Range;
  /** Before 0.2: prompts lived inside Chats, and Setup was one tab. */
  chatsMode?: "chats" | "prompts";
}

const saved = loadViewState<Persisted>({ tab: "home", filter: null, range: "month" });

/** The tab to open on, including tabs saved by older versions. */
export function restoredTab(p: { tab?: unknown; chatsMode?: unknown }): Tab {
  if (p.tab === "chats" && p.chatsMode === "prompts") return "prompts";
  if (p.tab === "setup") return "config";
  return isTab(p.tab) ? p.tab : "home";
}

export const tab = signal<Tab>(restoredTab(saved));
/** null = not chosen yet; picks "This folder" when it has chats, else "All". */
export const filter = signal<Filter | null>(saved.filter);
export const query = signal("");
export const range = signal<Range>(saved.range);
export const usage = signal<UsageSnapshot | null>(null);
export const setup = signal<SetupSnapshot | null>(null);
export const account = signal<AccountSnapshot | null>(null);
/** Chats with file checkpoints; null until the host has looked. */
export const checkpoints = signal<CheckpointSummary[] | null>(null);
export const catalog = signal<SettingDef[]>([]);
/** Setup search text and which sections are open. */
export const setupQuery = signal("");
export const openSections = signal<string[]>(["health"]);
/** Skills tab: which skills to list. */
export const skillScope = signal<"all" | "project" | "user" | "plugin">("all");
/** The welcome screen listing everything in Orbit. */
export const welcome = signal(false);
let welcomeShown = false;
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
/** Get started checklist on Home (hidden when dismissed or until the host says otherwise). */
export const onboarding = signal<Onboarding>({ done: [], dismissed: true });
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
      onboarding.value = m.onboarding ?? { done: [], dismissed: true };
      // First time ever: show what's in Orbit (once; the host remembers).
      if (m.onboarding?.welcomed === false && !welcomeShown) {
        welcomeShown = true;
        welcome.value = true;
      }
      here.value = m.here;
      env.value = m.env;
      error.value = null;
      loaded.value = true;
      break;
    case "usage":
      usage.value = m.data;
      break;
    case "account":
      account.value = m.data;
      break;
    case "checkpoints":
      checkpoints.value = m.items;
      break;
    case "goto":
      details.value = null;
      tab.value = m.tab;
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
