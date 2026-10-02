import { effect, signal } from "@preact/signals";
import type { SetupSnapshot } from "../extension/setupService";
import type { UsageSnapshot } from "../extension/usageService";
import type { AccountSnapshot } from "../features/account/accounts";
import type { ConversationPage } from "../features/chats/conversation";
import type { MessageHit } from "../features/chats/search";
import type { LiveStatus, Session } from "../features/chats/types";
import type { PromptEntry } from "../features/prompts/library";
import type { SettingDef } from "../features/setup/catalog";
import type { MemoryFile } from "../features/setup/memory";
import type { CheckpointSummary } from "../features/timeline/summary";
import type { Onboarding } from "../shared/onboarding";
import type { ChangedFileView, Environment, HostMsg } from "../shared/protocol";
import { isTab, type Tab } from "../shared/tabs";
import { loadViewState, saveViewState } from "./bus";
import { type ChatFilter, DEFAULT_FILTER } from "./chats/model";

export type { Tab } from "../shared/tabs";

export type Range = "today" | "week" | "month" | "all";

interface Persisted {
  tab: Tab;
  /** The Chats tab's filters; null until the person changes one (then their defaults apply). */
  chatFilter?: ChatFilter | null;
  collapsed?: string[];
  usageShut?: string[];
  range: Range;
  /** Before 0.2: prompts lived inside Chats, and Setup was one tab. */
  chatsMode?: "chats" | "prompts";
}

const saved = loadViewState<Persisted>({ tab: "home", range: "month" });

/** The tab to open on, including tabs saved by older versions. */
export function restoredTab(p: { tab?: unknown; chatsMode?: unknown }): Tab {
  if (p.tab === "chats" && p.chatsMode === "prompts") return "prompts";
  if (p.tab === "setup") return "config";
  return isTab(p.tab) ? p.tab : "home";
}

export const tab = signal<Tab>(restoredTab(saved));
/** The Chats filters; null until changed, so Orbit's "Chats start with" settings apply. */
export const chatFilter = signal<ChatFilter | null>(saved.chatFilter ?? null);
/** The filters in effect: the person's own, else their defaults. */
export function filters(): ChatFilter {
  if (chatFilter.value) return chatFilter.value;
  const p = env.value?.prefs;
  return {
    ...DEFAULT_FILTER,
    date: p?.defaultFilter ?? DEFAULT_FILTER.date,
    project: p?.defaultProject === "current" ? "here" : "all",
  };
}
export function setFilters(next: Partial<ChatFilter>): void {
  chatFilter.value = { ...filters(), ...next };
}
/** Usage sections the person closed. */
export const usageShut = signal<string[]>(saved.usageShut ?? []);
/** Chats date groups the person collapsed. */
export const collapsed = signal<string[]>(saved.collapsed ?? []);
/** Bulk selection in Chats; null when not selecting. */
export const selected = signal<string[] | null>(null);
/** Pages of the open chat's conversation, by request. */
export const conversation = signal<{ id: string; req: string; page: ConversationPage } | null>(
  null,
);
export const query = signal("");
export const range = signal<Range>(saved.range);
export const usage = signal<UsageSnapshot | null>(null);
export const setup = signal<SetupSnapshot | null>(null);
export const account = signal<AccountSnapshot | null>(null);
/** Chats with file checkpoints; null until the host has looked. */
export const checkpoints = signal<CheckpointSummary[] | null>(null);
/** The chat open on the Checkpoints tab, and its files once the host has read them. */
export const cpOpen = signal<string | null>(null);
export const cpFiles = signal<Extract<HostMsg, { type: "cp:files" }> | null>(null);
export const catalog = signal<SettingDef[]>([]);
/** Setup search text and which sections are open. */
export const setupQuery = signal("");
export const openSections = signal<string[]>(["health"]);
/** Skills tab: which skills to list. */
export const skillScope = signal<"all" | "project" | "user" | "plugin">("all");
/** When the refresh button was pressed; null once fresh data arrived (shown at least 700 ms). */
export const reloading = signal<number | null>(null);
const MIN_SPIN = 700;
/** The Ctrl/Cmd+K palette is open. */
export const paletteOpen = signal(false);
/** Config's settings history: Orbit's changes and its trash; null until read. */
export const history = signal<Omit<Extract<HostMsg, { type: "history" }>, "type"> | null>(null);
/** Memory tab: which memories, and whose ("" is this project's). */
export const memoryLens = signal<"all" | "orphans" | "broken">("all");
export const memoryProject = signal("");
export const memoryOther = signal<{ slug: string; files: MemoryFile[] } | null>(null);
/** Plugins tab: everything, only problems, or where plugins come from. */
export const pluginView = signal<"all" | "issues" | "sources">("all");
/** Commands tab: which commands to show. */
export const commandScope = signal<"all" | "builtin" | "project" | "user" | "plugin">("all");
/** Agents tab: only agents on this model family. */
export const agentModel = signal<
  "all" | "sonnet" | "opus" | "haiku" | "fable" | "inherit" | "custom"
>("all");
/** A detail page open on a setup tab: which tab, and the item's key (usually its file). */
export const setupDetail = signal<{ page: Tab; key: string } | null>(null);
/** The text of the file a detail page shows. */
export const setupContent = signal<{
  file: string;
  text: string | null;
  truncated: boolean;
} | null>(null);
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
/** Prompts tab: only this project folder ("" for all). */
export const promptProject = signal("");
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
/** Ticks every 30 s so "Updated 2m ago" and "Resets in 1h" stay true while idle. */
export const now = signal(Date.now());
if (typeof window !== "undefined") setInterval(() => (now.value = Date.now()), 30_000);

export const loaded = signal(false);
export const error = signal<string | null>(null);
export const sessions = signal<Session[]>([]);
export const live = signal<LiveStatus[]>([]);
export const pins = signal<string[]>([]);
export const renames = signal<Record<string, string>>({});
export const tags = signal<Record<string, string[]>>({});
/** Get started checklist on Home (hidden when dismissed or until the host says otherwise). */
export const onboarding = signal<Onboarding>({ done: [], dismissed: true });
export const archived = signal<string[]>([]);
export const hidden = signal<string[]>([]);
export const temp = signal<string[]>([]);
/** Running chats whose terminal Orbit can show. */
export const terminals = signal<string[]>([]);
export const here = signal<string[]>([]);
export const env = signal<Environment | null>(null);

effect(() => {
  saveViewState({
    tab: tab.value,
    chatFilter: chatFilter.value,
    collapsed: collapsed.value,
    usageShut: usageShut.value,
    range: range.value,
  } satisfies Persisted);
});

export function applyHostMessage(m: HostMsg): void {
  switch (m.type) {
    case "sessions": {
      const since = reloading.value;
      if (since !== null) {
        const left = MIN_SPIN - (Date.now() - since);
        if (left <= 0) reloading.value = null;
        else
          setTimeout(() => {
            if (reloading.value === since) reloading.value = null;
          }, left);
      }
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
      archived.value = m.archived ?? [];
      hidden.value = m.hidden ?? [];
      temp.value = m.temp ?? [];
      terminals.value = m.terminals ?? [];
      error.value = null;
      loaded.value = true;
      break;
    }
    case "usage":
      usage.value = m.data;
      break;
    case "account":
      account.value = m.data;
      break;
    case "checkpoints":
      checkpoints.value = m.items;
      break;
    case "cp:files":
      if (cpOpen.value === m.id) cpFiles.value = m;
      break;
    case "goto":
      details.value = null;
      tab.value = m.tab;
      break;
    case "setup":
      setup.value = m.data;
      break;
    case "history":
      history.value = { edits: m.edits, trash: m.trash };
      break;
    case "setup:memoryFiles":
      if (memoryProject.value === m.slug) memoryOther.value = { slug: m.slug, files: m.files };
      break;
    case "setup:content":
      setupContent.value = { file: m.file, text: m.text, truncated: m.truncated };
      break;
    case "catalog":
      catalog.value = m.data;
      break;
    case "chat:conversation":
      if (details.value?.id === m.id) conversation.value = { id: m.id, req: m.req, page: m.page };
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
