import { useComputed } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { post } from "../bus";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { Icon, IconButton } from "../ui/Icon";
import { VirtualList } from "../ui/VirtualList";
import { ChatDetails, openDetails } from "./ChatDetails";
import { effectiveFilter } from "./filter";
import { currentHits, MessageResults, useMessageSearch } from "./MessageSearch";
import {
  branchesOf,
  buildItems,
  type ChatVM,
  type Filter,
  type Item,
  projectsOf,
  relativeTime,
} from "./model";
import { PromptsView } from "./PromptsView";

const HEADER_H = 30;
const ROW_H = 54;
const itemHeight = (i: Item) => (i.kind === "header" ? HEADER_H : ROW_H);
const itemKey = (i: Item) => i.key;

/** Purely visual: the status is also written out in the row text for screen readers. */
function LiveDot({ vm }: { vm: ChatVM }) {
  if (!vm.live) return null;
  return (
    <span class={`live-dot ${vm.live.status === "busy" ? "busy" : "idle"}`} aria-hidden="true" />
  );
}

interface RowProps {
  vm: ChatVM;
  active: boolean;
  now: number;
  renaming: boolean;
  onRename: (on: boolean) => void;
}

function ChatRow({ vm, active, now, renaming, onRename }: RowProps) {
  const { s } = vm;
  const [draft, setDraft] = useState(vm.title);
  const meta = [
    s.project,
    s.branch,
    relativeTime(s.lastActiveAt, now),
    `${s.prompts}${s.estimated ? "+" : ""} prompts`,
  ]
    .filter(Boolean)
    .join(" · ");

  const save = () => {
    post({ type: "rename", id: s.id, title: draft.trim() === s.title ? "" : draft });
    onRename(false);
  };

  return (
    <div
      data-row="chat"
      class={`chat-row${active ? " active" : ""}`}
      id={`chat-${s.id}`}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      title={s.firstPrompt && s.firstPrompt !== vm.title ? s.firstPrompt : undefined}
      onClick={() => !renaming && post({ type: "openChat", id: s.id })}
      onKeyDown={(e) => {
        // Keys pressed on a row button belong to that button, not the row.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" && !renaming) post({ type: "openChat", id: s.id });
      }}
    >
      <div class="chat-main">
        <div class="chat-title-line">
          <LiveDot vm={vm} />
          {vm.pinned ? <Icon name="pinned" /> : null}
          {renaming ? (
            <input
              class="rename-input"
              aria-label="New name"
              value={draft}
              maxLength={200}
              ref={(el) => el?.focus()}
              onClick={(e) => e.stopPropagation()}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") save();
                if (e.key === "Escape") onRename(false);
              }}
              onBlur={() => onRename(false)}
            />
          ) : (
            <span class="chat-title">{vm.title}</span>
          )}
        </div>
        <div class="chat-meta">
          {vm.live ? (
            <span class={`live-label ${vm.live.status}`}>{LIVE_LABEL[vm.live.status]} · </span>
          ) : null}
          {meta}
          {vm.tags.length ? (
            <span class="chat-tags">
              {vm.tags.map((t) => (
                <span key={t} class="chat-tag">
                  #{t}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
      <div class="chat-actions">
        {s.prLinks.length ? (
          <IconButton
            icon="git-pull-request"
            label="Open pull request"
            onClick={() => post({ type: "openLink", url: s.prLinks[s.prLinks.length - 1]! })}
          />
        ) : null}
        <IconButton icon="history" label="Files and transcript" onClick={() => openDetails(s.id)} />
        <IconButton
          icon="terminal"
          label="Continue in terminal"
          onClick={() => post({ type: "openTerminal", id: s.id })}
        />
        <IconButton
          icon="copy"
          label="Copy resume command"
          onClick={() => post({ type: "copyResume", id: s.id })}
        />
        <IconButton icon="edit" label="Rename" onClick={() => onRename(true)} />
        <IconButton
          icon={vm.pinned ? "pinned" : "pin"}
          label={vm.pinned ? "Unpin" : "Pin"}
          pressed={vm.pinned}
          onClick={() => post({ type: "pin", id: s.id, on: !vm.pinned })}
        />
      </div>
    </div>
  );
}

const LIVE_LABEL = { busy: "Working…", idle: "Waiting for you", unknown: "Running" } as const;

function Chip({ value, label, count }: { value: Filter; label: string; count?: number }) {
  const on = effectiveFilter() === value;
  return (
    <button
      type="button"
      class={`chip${on ? " on" : ""}`}
      aria-pressed={on}
      onClick={() => (store.filter.value = value)}
    >
      {label}
      {count !== undefined ? <span class="chip-count">{count}</span> : null}
    </button>
  );
}

const chatsInput = () => ({
  sessions: store.sessions.value,
  live: store.live.value,
  pins: store.pins.value,
  renames: store.renames.value,
  here: store.here.value,
  tags: store.tags.value,
});

/** Chats, or the prompt library, with one chat's details when opened. */
export function ChatsView() {
  const mode = store.chatsMode.value;
  // The chats in view (chip + filter menus), which search inside messages covers.
  const inView = useComputed(() =>
    buildItems(chatsInput(), "", effectiveFilter(), store.now.value, store.narrow.value).flatMap(
      (i) => (i.kind === "chat" ? [i.vm.s.id] : []),
    ),
  ).value;
  useMessageSearch(mode === "chats", inView);
  return (
    <div class="chats-tab">
      <fieldset class="segmented mode-switch">
        <legend class="sr-only">Show</legend>
        {(["chats", "prompts"] as const).map((m) => (
          <label key={m} class={mode === m ? "on" : ""}>
            <input
              type="radio"
              name="chats-mode"
              class="sr-only"
              checked={mode === m}
              onChange={() => (store.chatsMode.value = m)}
            />
            {m === "chats" ? "Chats" : "Prompts"}
          </label>
        ))}
      </fieldset>
      {mode === "prompts" ? (
        <section class="chats">
          <PromptsView />
        </section>
      ) : store.details.value ? (
        <ChatDetails />
      ) : (
        <ChatList />
      )}
    </div>
  );
}

function ChatList() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [kbd, setKbd] = useState(false);
  const now = Date.now();

  const items = useComputed(() =>
    buildItems(
      chatsInput(),
      store.query.value,
      effectiveFilter(),
      store.now.value,
      store.narrow.value,
    ),
  ).value;
  const inMessages = store.inMessages.value;
  const hits = inMessages ? currentHits() : [];
  const [activeHit, setActiveHit] = useState(0);
  const hit = hits[Math.min(activeHit, hits.length - 1)];
  const [filtersOpen, setFiltersOpen] = useState(false);
  const chatIdx = items.flatMap((it, i) => (it.kind === "chat" ? [i] : []));
  const activeItem = chatIdx[Math.min(active, chatIdx.length - 1)];
  const activeEntry = activeItem === undefined ? undefined : items[activeItem];
  const activeChatId = activeEntry?.kind === "chat" ? `chat-${activeEntry.vm.s.id}` : undefined;

  useEffect(() => {
    setActive(0);
    setActiveHit(0);
  }, [store.query.value, store.filter.value, inMessages]);

  // The first search ticks "Find an old chat" in Get started.
  const searching = store.query.value.trim() !== "";
  useEffect(() => {
    if (searching && !store.onboarding.value.done.includes("find"))
      post({ type: "onboarding", action: "find" });
  }, [searching]);

  useEffect(() => {
    if (!store.focusSearch.value) return;
    store.focusSearch.value = false;
    searchRef.current?.focus();
  }, []);

  // "/" focuses search from anywhere in the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && t?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /** Keyboard equivalents of every row action, applied to the highlighted chat. */
  const rowShortcut = (e: KeyboardEvent, vm: ChatVM): boolean => {
    const id = vm.s.id;
    const is = (letter: string) =>
      e.altKey && (e.key.toLowerCase() === letter || e.code === `Key${letter.toUpperCase()}`);
    if (e.key === "Enter") post({ type: e.shiftKey ? "openTerminal" : "openChat", id });
    else if (is("p")) post({ type: "pin", id, on: !vm.pinned });
    else if (is("c")) post({ type: "copyResume", id });
    else if (is("d")) openDetails(id);
    else if (e.key === "F2") setRenaming(id);
    else return false;
    return true;
  };

  /** While searching messages, the keys work the results you can see. */
  const onHitKey = (e: KeyboardEvent): boolean => {
    const altD = e.altKey && (e.key.toLowerCase() === "d" || e.code === "KeyD");
    if (e.key === "ArrowDown") setActiveHit((a) => Math.min(a + 1, hits.length - 1));
    else if (e.key === "ArrowUp") setActiveHit((a) => Math.max(a - 1, 0));
    else if (e.key === "Enter" && hit) post({ type: "openChat", id: hit.sessionId });
    else if (altD && hit) openDetails(hit.sessionId);
    else return false;
    return true;
  };

  const onSearchKey = (e: KeyboardEvent) => {
    if (inMessages && onHitKey(e)) {
      e.preventDefault();
      return;
    }
    if (inMessages && e.key !== "Escape") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, chatIdx.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (activeEntry?.kind === "chat" && rowShortcut(e, activeEntry.vm)) {
      e.preventDefault();
    } else if (e.key === "Escape") {
      store.query.value = "";
    }
  };

  const all = store.sessions.value;
  const hasWorkspace = store.env.value?.hasWorkspace ?? false;
  const liveCount = store.live.value.filter((l) => all.some((s) => s.id === l.sessionId)).length;

  let body: ComponentChildren;
  if (inMessages && store.loaded.value && all.length > 0) {
    body = <MessageResults active={Math.min(activeHit, Math.max(hits.length - 1, 0))} />;
  } else if (!store.loaded.value) {
    body = (
      <div class="loading" role="status">
        Loading your chats…
      </div>
    );
  } else if (store.error.value) {
    body = (
      <Empty
        icon="warning"
        title="Couldn't read your chats"
        action={{ label: "Try again", onClick: () => post({ type: "refresh" }) }}
      >
        {store.error.value}
      </Empty>
    );
  } else if (all.length === 0) {
    body = (
      <Empty icon="comment-discussion" title="No chats yet">
        Start a conversation in Claude Code. It shows up here instantly.
      </Empty>
    );
  } else if (items.length === 0) {
    const q = store.query.value;
    body = q ? (
      <Empty
        icon="search"
        title={`No chats match "${q}"`}
        action={{ label: "Clear search", onClick: () => (store.query.value = "") }}
      />
    ) : (
      <Empty
        icon="filter"
        title="Nothing here yet"
        action={{
          label: "Show all chats",
          onClick: () => {
            store.filter.value = "all";
            store.narrow.value = { project: null, branch: null, since: null };
          },
        }}
      >
        No chats match this filter.
      </Empty>
    );
  } else {
    body = (
      <VirtualList
        items={items}
        itemKey={itemKey}
        height={itemHeight}
        activeIndex={activeItem}
        label="Chats"
        id="chat-list"
        render={(it, i) =>
          it.kind === "header" ? (
            <div class="group-header" role="presentation">
              <span>{it.label}</span>
              <span class="group-count">{it.count}</span>
            </div>
          ) : (
            <ChatRow
              vm={it.vm}
              now={now}
              active={i === activeItem}
              renaming={renaming === it.vm.s.id}
              onRename={(on) => {
                setRenaming(on ? it.vm.s.id : null);
                if (!on) searchRef.current?.focus();
              }}
            />
          )
        }
      />
    );
  }

  return (
    <section class={`chats${kbd ? " kbd" : ""}`}>
      <div class="toolbar">
        <div class="search">
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-keyshortcuts="Enter Shift+Enter Alt+P Alt+C Alt+D F2"
            title="↑↓ to move · Enter: continue · Shift+Enter: terminal · Alt+P: pin · Alt+C: copy command · Alt+D: files and transcript · F2: rename"
            placeholder="Search chats"
            aria-label="Search chats"
            aria-controls={inMessages ? "hit-list" : "chat-list"}
            aria-activedescendant={
              inMessages ? (hit ? `hit-${hit.sessionId}` : undefined) : activeChatId
            }
            value={store.query.value}
            onInput={(e) => (store.query.value = (e.target as HTMLInputElement).value)}
            onKeyDown={onSearchKey}
            onFocus={() => setKbd(true)}
            onBlur={() => setKbd(false)}
          />
          <kbd class="hint">/</kbd>
        </div>
        <div class="toolbar-row">
          <label class="check" title="Also search everything you and Claude wrote in your chats">
            <input
              type="checkbox"
              checked={store.inMessages.value}
              onChange={(e) => (store.inMessages.value = (e.target as HTMLInputElement).checked)}
            />
            In messages
          </label>
          <button
            type="button"
            class={`filter-btn${filtersOpen || narrowed() ? " on" : ""}`}
            aria-label="More filters"
            aria-expanded={filtersOpen || narrowed()}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Icon name="filter" />
            Filters{narrowed() ? " (on)" : ""}
          </button>
        </div>
        <fieldset class="chips">
          <legend class="sr-only">Filter chats</legend>
          {hasWorkspace ? (
            <Chip value="workspace" label="This folder" count={store.here.value.length} />
          ) : null}
          <Chip value="all" label="All" count={all.length} />
          <Chip value="pinned" label="Pinned" />
          {liveCount > 0 ? <Chip value="live" label="Running" count={liveCount} /> : null}
        </fieldset>
        {filtersOpen || narrowed() ? <FilterRow /> : null}
        {all.length > 0 && !store.onboarding.value.done.includes("continue") ? (
          <p class="list-hint">
            <Icon name="info" />
            Click a chat to open it in Claude and keep typing there.
          </p>
        ) : null}
      </div>
      {body}
    </section>
  );
}

const narrowed = () => {
  const n = store.narrow.value;
  return n.project !== null || n.since !== null;
};

/** Folder, branch (within a folder) and how recent. */
function FilterRow() {
  const n = store.narrow.value;
  const sessions = store.sessions.value;
  const projects = projectsOf(sessions);
  const branches = n.project ? branchesOf(sessions, n.project) : [];
  const set = (next: Partial<typeof n>) => {
    store.narrow.value = { ...n, ...next };
  };
  return (
    <div class="filter-row">
      <label class="field inline">
        <span>Folder</span>
        <select
          value={n.project ?? ""}
          onChange={(e) =>
            set({ project: (e.target as HTMLSelectElement).value || null, branch: null })
          }
        >
          <option value="">All folders</option>
          {projects.map((p) => (
            <option key={p.cwd} value={p.cwd}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {branches.length ? (
        <label class="field inline">
          <span>Branch</span>
          <select
            value={n.branch ?? ""}
            onChange={(e) => set({ branch: (e.target as HTMLSelectElement).value || null })}
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label class="field inline">
        <span>When</span>
        <select
          value={n.since ?? ""}
          onChange={(e) =>
            set({ since: ((e.target as HTMLSelectElement).value || null) as typeof n.since })
          }
        >
          <option value="">Any time</option>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
        </select>
      </label>
      {narrowed() ? (
        <button
          type="button"
          class="btn small secondary"
          onClick={() => {
            store.narrow.value = { project: null, branch: null, since: null };
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
