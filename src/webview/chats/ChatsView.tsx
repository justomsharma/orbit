import { useComputed } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { post } from "../bus";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { Icon, IconButton } from "../ui/Icon";
import { Loading } from "../ui/Loading";
import { showMenu } from "../ui/Menu";
import { Segmented } from "../ui/Segmented";
import { VirtualList } from "../ui/VirtualList";
import { ChatDetails } from "./ChatDetails";
import { LIVE_LABEL, LIVE_TITLE, liveClass } from "./live";
import { currentHits, MessageResults, useMessageSearch } from "./MessageSearch";
import { rowMenu } from "./menu";
import {
  buildItems,
  type ChatFilter,
  type ChatVM,
  type DateFilter,
  DEFAULT_FILTER,
  exactTime,
  facets,
  type Item,
  RECENT,
  relativeTime,
  visible,
  type WorktreeFilter,
} from "./model";
import { openDetails } from "./open";

const HEADER_H = 30;
const itemKey = (i: Item) => i.key;

const subtitleOf = (vm: ChatVM) =>
  vm.s.firstPrompt &&
  vm.s.firstPrompt !== vm.title &&
  !vm.title.startsWith(vm.s.firstPrompt.slice(0, 40))
    ? vm.s.firstPrompt
    : "";

/** How tall a row is: title, then a prompt line when it differs, then the tags line. */
const rowHeight = (vm: ChatVM) => 46 + (subtitleOf(vm) ? 18 : 0);
const itemHeight = (i: Item) => (i.kind === "header" ? HEADER_H : rowHeight(i.vm));

const chatsInput = () => ({
  sessions: store.sessions.value,
  live: store.live.value,
  pins: store.pins.value,
  renames: store.renames.value,
  here: store.here.value,
  tags: store.tags.value,
  archived: store.archived.value,
  hidden: store.hidden.value,
  temp: store.temp.value,
  terminals: store.terminals.value,
});

/** Your filter defaults (Orbit's "Chats start with" settings). */
function defaults(): ChatFilter {
  const p = store.env.value?.prefs;
  return {
    ...DEFAULT_FILTER,
    date: p?.defaultFilter ?? DEFAULT_FILTER.date,
    project: p?.defaultProject === "current" ? "here" : "all",
  };
}

/** Purely visual: the status is also written out in the row text for screen readers. */
function LiveDot({ vm }: { vm: ChatVM }) {
  if (!vm.live) return null;
  return (
    <span
      class={`live-dot ${liveClass(vm.live.status)}`}
      title={LIVE_TITLE[vm.live.status]}
      aria-hidden="true"
    />
  );
}

function Tags({ vm }: { vm: ChatVM }) {
  const { s } = vm;
  const w = s.worktree;
  return (
    <span class="row-tags">
      {vm.temp ? (
        <span
          class="tag temp"
          title="Temporary chat: hidden from the list when its terminal closes. Make it permanent from its ⋯ menu."
        >
          Temp
        </span>
      ) : null}
      {w ? (
        <span
          class={`tag wt ${w.kind}${w.removed ? " removed" : ""}`}
          title={`${w.kind === "claude" ? "Worktree Claude made" : "Your worktree"} · ${w.name}${s.branch ? ` · ${s.branch}` : ""}${w.removed ? " · removed from disk" : ""}`}
        >
          <Icon name={w.kind === "claude" ? "hubot" : "git-branch"} />
          <span class="tag-name">{w.name}</span>
          {s.branch ? <span class="tag-dim"> · {s.branch}</span> : null}
        </span>
      ) : s.branch ? (
        <span class="tag" title={`Branch ${s.branch}`}>
          <Icon name="git-branch" />
          <span class="tag-name">{s.branch}</span>
        </span>
      ) : null}
      <span class="tag folder" title={s.cwd}>
        <Icon name="folder" />
        <span class="tag-name">{s.project}</span>
      </span>
      {vm.tags.map((t) => (
        <span key={t} class="chat-tag">
          #{t}
        </span>
      ))}
    </span>
  );
}

interface RowProps {
  vm: ChatVM;
  active: boolean;
  now: number;
  renaming: boolean;
  onRename: (on: boolean) => void;
  /** null when not selecting. */
  selected: boolean | null;
}

function ChatRow({ vm, active, now, renaming, onRename, selected }: RowProps) {
  const { s } = vm;
  const [draft, setDraft] = useState(vm.title);
  const sub = subtitleOf(vm);
  const selecting = selected !== null;
  const save = () => {
    post({ type: "rename", id: s.id, title: draft.trim() === s.title ? "" : draft });
    onRename(false);
  };
  const toggle = () => {
    const cur = new Set(store.selected.value ?? []);
    if (cur.has(s.id)) cur.delete(s.id);
    else cur.add(s.id);
    store.selected.value = [...cur];
  };
  const open = () => {
    if (selecting) toggle();
    else if (!renaming) post({ type: "openChat", id: s.id });
  };
  const primary = vm.live
    ? { icon: "terminal", label: vm.linked ? "Show its terminal" : "Running: switch to it" }
    : { icon: "play", label: "Continue this chat" };
  const status = vm.live ? `${LIVE_LABEL[vm.live.status]}. ` : "";
  const menu = (at: HTMLElement | { x: number; y: number }) =>
    showMenu(
      rowMenu(vm, () => onRename(true)),
      at,
      `${vm.title} actions`,
    );

  return (
    <div
      data-row="chat"
      class={`chat-row${active ? " active" : ""}${selected ? " selected" : ""}`}
      id={`chat-${s.id}`}
      role="option"
      tabIndex={-1}
      aria-selected={selecting ? !!selected : active}
      aria-label={`${status}${vm.title}`}
      onClick={open}
      onContextMenu={(e) => {
        if (selecting) return;
        e.preventDefault();
        menu({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        // Keys pressed on a row button belong to that button, not the row.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") open();
      }}
    >
      <div class="chat-main">
        <div class="chat-title-line">
          <LiveDot vm={vm} />
          {selecting ? <Icon name={selected ? "pass-filled" : "circle-large-outline"} /> : null}
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
          <span class="chat-time" title={exactTime(s.lastActiveAt)}>
            {vm.live ? (
              <span class={`live-label ${vm.live.status}`}>{LIVE_LABEL[vm.live.status]}</span>
            ) : (
              relativeTime(s.lastActiveAt, now)
            )}
          </span>
          {vm.pinned ? <Icon name="pinned" /> : null}
        </div>
        {sub ? <div class="chat-sub">{sub}</div> : null}
        <div class="chat-meta">
          <Tags vm={vm} />
        </div>
      </div>
      {selecting ? null : (
        <div class="chat-actions">
          <button
            type="button"
            class="row-go"
            title={primary.label}
            aria-label={`${primary.label}: ${vm.title}`}
            onClick={(e) => {
              e.stopPropagation();
              post({ type: "openChat", id: s.id });
            }}
          >
            <Icon name={primary.icon} />
          </button>
          {s.prLinks.length ? (
            <IconButton
              icon="git-pull-request"
              label="Open pull request"
              onClick={() => post({ type: "openLink", url: s.prLinks[s.prLinks.length - 1]! })}
            />
          ) : null}
          <IconButton
            icon="history"
            label="Files and transcript"
            onClick={() => openDetails(s.id)}
          />
          <IconButton
            icon={vm.pinned ? "pinned" : "pin"}
            label={vm.pinned ? "Unpin" : "Pin"}
            pressed={vm.pinned}
            onClick={() => post({ type: "pin", id: s.id, on: !vm.pinned })}
          />
          <button
            type="button"
            class="icon-btn"
            title="More actions"
            aria-label={`More actions for ${vm.title}`}
            aria-haspopup="menu"
            onClick={(e) => {
              e.stopPropagation();
              menu(e.currentTarget as HTMLElement);
            }}
          >
            <Icon name="ellipsis" />
          </button>
        </div>
      )}
    </div>
  );
}

/** New chat, continue the last one, and the other ways to start. */
function LaunchBar() {
  return (
    <div class="launch">
      <button
        type="button"
        class="btn launch-new"
        title="Start a new Claude Code chat"
        onClick={() => post({ type: "newChat" })}
      >
        <Icon name="add" /> New chat
      </button>
      <IconButton
        icon="history"
        label="Continue the last chat in this folder (claude --continue)"
        onClick={() => post({ type: "continueLast" })}
      />
      <button
        type="button"
        class="icon-btn"
        title="More ways to start"
        aria-label="More ways to start a chat"
        aria-haspopup="menu"
        onClick={(e) =>
          showMenu(
            [
              {
                label: "New temporary chat",
                icon: "eye-closed",
                run: () => post({ type: "chats:newTemp" }),
              },
              { kind: "separator" },
              {
                label: "Restore recent terminals",
                icon: "split-horizontal",
                run: () => post({ type: "chats:restore" }),
              },
              { kind: "separator" },
              {
                label: "Import a chat…",
                icon: "cloud-download",
                run: () => post({ type: "chats:import", many: false }),
              },
              {
                label: "Import many…",
                icon: "package",
                run: () => post({ type: "chats:import", many: true }),
              },
            ],
            e.currentTarget as HTMLElement,
            "Start a chat",
          )
        }
      >
        <Icon name="ellipsis" />
      </button>
    </div>
  );
}

const DATE_LABEL: Record<DateFilter, string> = {
  recent: "Recent",
  week: "Week",
  month: "Month",
  all: "All",
};

const WORKTREE_LABEL: Record<WorktreeFilter, string> = {
  all: "All checkouts",
  main: "Main checkout",
  claude: "Claude's worktrees",
  user: "Your worktrees",
};

/** Folder, branch, checkout, how recent, and which list. Counts show what each would leave. */
function FilterPanel({ f }: { f: ChatFilter }) {
  const fx = facets(chatsInput(), f, store.now.value);
  return (
    <div class="filter-panel">
      <label class="field inline">
        <span>Folder</span>
        <select
          value={f.project}
          onChange={(e) =>
            store.setFilters({ project: (e.target as HTMLSelectElement).value, branch: null })
          }
        >
          {fx.projects
            .filter((p) => p.value !== "here" || store.env.value?.hasWorkspace)
            .map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} ({p.count})
              </option>
            ))}
        </select>
      </label>
      {fx.branches.length > 2 ? (
        <label class="field inline">
          <span>Branch</span>
          <select
            value={f.branch ?? "*"}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              store.setFilters({ branch: v === "*" ? null : v });
            }}
          >
            {fx.branches.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label} ({b.count})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fx.hasWorktrees ? (
        <label class="field inline">
          <span>Checkout</span>
          <select
            value={f.worktree}
            onChange={(e) =>
              store.setFilters({
                worktree: (e.target as HTMLSelectElement).value as WorktreeFilter,
              })
            }
          >
            {fx.worktrees.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label} ({w.count})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <Segmented<DateFilter>
        legend="How recent"
        value={f.date}
        onChange={(date) => store.setFilters({ date })}
        options={(["recent", "week", "month", "all"] as const).map((v) => ({
          value: v,
          label: DATE_LABEL[v],
        }))}
      />
      <Segmented<ChatFilter["view"]>
        legend="Which list"
        value={f.view}
        onChange={(view) => store.setFilters({ view })}
        options={[
          { value: "chats", label: "Chats" },
          { value: "archived", label: "Archived", count: store.archived.value.length },
          { value: "hidden", label: "Hidden", count: store.hidden.value.length },
        ]}
      />
    </div>
  );
}

/** Filters that differ from your defaults, each with a way to clear it. */
function Chips({ f }: { f: ChatFilter }) {
  const d = defaults();
  const projectLabel = (v: string) =>
    v === "here"
      ? "This folder"
      : v === "all"
        ? "All folders"
        : (store.sessions.value.find((s) => s.cwd === v)?.project ?? v);
  const chips: { key: keyof ChatFilter; label: string }[] = [];
  if (f.view !== "chats")
    chips.push({ key: "view", label: f.view === "archived" ? "Archived" : "Hidden" });
  if (f.date !== d.date) chips.push({ key: "date", label: DATE_LABEL[f.date] });
  if (f.project !== d.project) chips.push({ key: "project", label: projectLabel(f.project) });
  if (f.branch !== null) chips.push({ key: "branch", label: f.branch || "(no branch)" });
  if (f.worktree !== "all") chips.push({ key: "worktree", label: WORKTREE_LABEL[f.worktree] });
  if (!chips.length) return null;
  return (
    <ul class="active-chips" aria-label="Active filters">
      {chips.map((c) => (
        <li key={c.key} class="achip">
          {c.label}
          <button
            type="button"
            aria-label={`Clear filter: ${c.label}`}
            onClick={() => store.setFilters({ [c.key]: d[c.key] } as Partial<ChatFilter>)}
          >
            <Icon name="close" />
          </button>
        </li>
      ))}
      {chips.length > 2 ? (
        <li>
          <button type="button" class="link-btn" onClick={() => (store.chatFilter.value = null)}>
            Clear all
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** "12 chats", collapse or open every group, and Select for doing many at once. */
function ListHeader({ items, ids }: { items: Item[]; ids: string[] }) {
  const sel = store.selected.value;
  const headers = items.filter((i): i is Extract<Item, { kind: "header" }> => i.kind === "header");
  const view = store.filters().view;
  if (sel !== null) {
    const n = sel.length;
    const chosen = new Set(sel);
    const allPinned = n > 0 && [...chosen].every((id) => store.pins.value.includes(id));
    return (
      <div class="list-head bulk" role="toolbar" aria-label="Selected chats">
        <span class="bulk-count">{n} selected</span>
        <button
          type="button"
          class="ghost-btn"
          disabled={!n}
          onClick={() => post({ type: "chat:pinMany", ids: sel, on: !allPinned })}
        >
          <Icon name={allPinned ? "pinned" : "pin"} /> {allPinned ? "Unpin" : "Pin"}
        </button>
        <button
          type="button"
          class="ghost-btn"
          disabled={!n}
          onClick={() => post({ type: "chat:save", ids: sel })}
        >
          <Icon name="export" /> Export
        </button>
        <button
          type="button"
          class="ghost-btn"
          disabled={!n}
          onClick={() => {
            post({ type: "chat:mark", ids: sel, set: "archived", on: view !== "archived" });
            store.selected.value = [];
          }}
        >
          <Icon name="archive" /> {view === "archived" ? "Unarchive" : "Archive"}
        </button>
        <button
          type="button"
          class="ghost-btn danger"
          disabled={!n}
          onClick={() => {
            post({ type: "chat:mark", ids: sel, set: "hidden", on: view !== "hidden" });
            store.selected.value = [];
          }}
        >
          <Icon name={view === "hidden" ? "eye" : "eye-closed"} />{" "}
          {view === "hidden" ? "Show again" : "Hide"}
        </button>
        <button
          type="button"
          class="ghost-btn"
          title="Stop selecting (Esc)"
          onClick={() => (store.selected.value = null)}
        >
          <Icon name="close" /> Cancel
        </button>
      </div>
    );
  }
  const allShut = headers.length > 0 && headers.every((h) => h.collapsed);
  return (
    <div class="list-head">
      <span class="list-count">
        {ids.length} chat{ids.length === 1 ? "" : "s"}
      </span>
      {headers.length > 1 ? (
        <IconButton
          icon={allShut ? "unfold" : "fold"}
          label={allShut ? "Open every group" : "Collapse every group"}
          onClick={() => (store.collapsed.value = allShut ? [] : headers.map((h) => h.label))}
        />
      ) : null}
      <button
        type="button"
        class="ghost-btn outline"
        title="Select chats to pin, export, archive or hide many at once"
        onClick={() => (store.selected.value = [])}
      >
        <Icon name="check" /> Select
      </button>
    </div>
  );
}

/** Every chat, with one chat's details when opened. */
export function ChatsView() {
  const inView = useComputed(() =>
    visible(chatsInput(), "", store.filters(), store.now.value).list.map((vm) => vm.s.id),
  ).value;
  useMessageSearch(true, inView);
  return <div class="chats-tab">{store.details.value ? <ChatDetails /> : <ChatList />}</div>;
}

function ChatList() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [kbd, setKbd] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const now = Date.now();
  const f = store.filters();

  const items = useComputed(() =>
    buildItems(
      chatsInput(),
      store.query.value,
      store.filters(),
      store.now.value,
      store.collapsed.value,
    ),
  ).value;
  const { list, more } = useComputed(() =>
    visible(chatsInput(), store.query.value, store.filters(), store.now.value),
  ).value;
  const inMessages = store.inMessages.value;
  const hits = inMessages ? currentHits() : [];
  const [activeHit, setActiveHit] = useState(0);
  const hit = hits[Math.min(activeHit, hits.length - 1)];
  const chatIdx = items.flatMap((it, i) => (it.kind === "chat" ? [i] : []));
  const activeItem = chatIdx[Math.min(active, chatIdx.length - 1)];
  const activeEntry = activeItem === undefined ? undefined : items[activeItem];
  const activeChatId = activeEntry?.kind === "chat" ? `chat-${activeEntry.vm.s.id}` : undefined;
  const selected = store.selected.value;
  const sel = new Set(selected ?? []);

  useEffect(() => {
    setActive(0);
    setActiveHit(0);
  }, [store.query.value, store.chatFilter.value, inMessages]);

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

  // "/" focuses search; while selecting, Ctrl+A selects every chat shown and Esc stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.tagName === "SELECT";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (store.selected.value !== null && !typing) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
          e.preventDefault();
          store.selected.value = list.map((vm) => vm.s.id);
        } else if (e.key === "Escape") store.selected.value = null;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [list]);

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
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const el = document.getElementById(`chat-${id}`);
      if (el)
        showMenu(
          rowMenu(vm, () => setRenaming(id)),
          el,
          `${vm.title} actions`,
        );
    } else return false;
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
  const scanning =
    inMessages && store.messageSearch.value !== null && store.messageHits.value?.done === false;

  let body: ComponentChildren;
  if (inMessages && store.loaded.value && all.length > 0) {
    body = <MessageResults active={Math.min(activeHit, Math.max(hits.length - 1, 0))} />;
  } else if (!store.loaded.value) {
    body = <Loading text="Loading your chats…" retry={{ type: "refresh" }} />;
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
        Start one with New chat above. It shows up here instantly.
      </Empty>
    );
  } else if (items.length === 0) {
    const q = store.query.value;
    body = q ? (
      <Empty
        icon="search"
        title={`No chats match "${q}"`}
        action={{ label: "Clear search", onClick: () => (store.query.value = "") }}
      >
        Try another word, or tick "In messages" to search everything that was said.
      </Empty>
    ) : f.view !== "chats" ? (
      <Empty
        icon={f.view === "archived" ? "archive" : "eye-closed"}
        title={f.view === "archived" ? "Nothing archived" : "Nothing hidden"}
      >
        {f.view === "archived"
          ? "Archive a chat from its ⋯ menu to keep it out of the list without losing it."
          : "Chats you hide wait here and can be shown again. Claude's own files are never deleted."}
      </Empty>
    ) : (
      <Empty
        icon="filter"
        title="Nothing here yet"
        action={{
          label: "Show all chats",
          onClick: () => store.setFilters({ ...DEFAULT_FILTER, date: "all" }),
        }}
      >
        No chats match these filters.
      </Empty>
    );
  } else {
    body = (
      <>
        <ListHeader items={items} ids={list.map((vm) => vm.s.id)} />
        <VirtualList
          items={items}
          itemKey={itemKey}
          height={itemHeight}
          activeIndex={activeItem}
          label="Chats"
          id="chat-list"
          render={(it, i) =>
            it.kind === "header" ? (
              <button
                type="button"
                class="group-header"
                aria-expanded={!it.collapsed}
                title={`${it.collapsed ? "Open" : "Collapse"} ${it.label} (${it.count})`}
                onClick={() => {
                  const cur = new Set(store.collapsed.value);
                  if (cur.has(it.label)) cur.delete(it.label);
                  else cur.add(it.label);
                  store.collapsed.value = [...cur];
                }}
              >
                <Icon name={it.collapsed ? "chevron-right" : "chevron-down"} />
                <span class="group-label">{it.label}</span>
                <span class="group-count">{it.count}</span>
              </button>
            ) : (
              <ChatRow
                vm={it.vm}
                now={now}
                active={i === activeItem}
                renaming={renaming === it.vm.s.id}
                selected={selected === null ? null : sel.has(it.vm.s.id)}
                onRename={(on) => {
                  setRenaming(on ? it.vm.s.id : null);
                  if (!on) searchRef.current?.focus();
                }}
              />
            )
          }
        />
        {more > 0 ? (
          <p class="list-more">
            Showing pinned chats and the {RECENT} most recent.{" "}
            <button
              type="button"
              class="link-btn"
              onClick={() => store.setFilters({ date: "all" })}
            >
              Show all {list.length + more}
            </button>
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section class={`chats${kbd ? " kbd" : ""}`}>
      <div class="toolbar">
        <LaunchBar />
        <div class="search-row">
          <div class="search">
            <Icon name="search" />
            <input
              ref={searchRef}
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-keyshortcuts="Enter Shift+Enter Alt+P Alt+C Alt+D F2"
              title="↑↓ to move · Enter: continue · Shift+Enter: terminal · Alt+P: pin · Alt+C: copy command · Alt+D: files and transcript · F2: rename · Shift+F10: more"
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
          {scanning ? <span class="spinner" role="status" aria-label="Searching chats" /> : null}
          <button
            type="button"
            class={`icon-btn${filtersOpen ? " on" : ""}`}
            title={filtersOpen ? "Hide filters" : "Filter chats"}
            aria-label={filtersOpen ? "Hide filters" : "Filter chats"}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Icon name="filter" />
          </button>
          <IconButton
            icon="refresh"
            label="Refresh chats"
            onClick={() => post({ type: "refresh" })}
          />
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
        </div>
        <Chips f={f} />
        {filtersOpen ? <FilterPanel f={f} /> : null}
        {all.length > 0 && !store.onboarding.value.done.includes("continue") ? (
          <p class="list-hint">
            <Icon name="info" />
            Click a chat to continue it. Right-click (or ⋯) for everything else.
          </p>
        ) : null}
      </div>
      {body}
    </section>
  );
}
