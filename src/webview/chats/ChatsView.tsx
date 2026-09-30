import { useComputed } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { post } from "../bus";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { Icon, IconButton } from "../ui/Icon";
import { VirtualList } from "../ui/VirtualList";
import { buildItems, type ChatVM, type Filter, type Item, relativeTime } from "./model";

const HEADER_H = 30;
const ROW_H = 54;
const itemHeight = (i: Item) => (i.kind === "header" ? HEADER_H : ROW_H);
const itemKey = (i: Item) => i.key;

function effectiveFilter(): Filter {
  const f = store.filter.value;
  if (f) return f;
  return store.here.value.length > 0 ? "workspace" : "all";
}

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
            <span class={`live-label ${vm.live.status}`}>
              {vm.live.status === "busy" ? "Working… · " : "Waiting for you · "}
            </span>
          ) : null}
          {meta}
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

export function ChatsView() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [kbd, setKbd] = useState(false);
  const now = Date.now();

  const items = useComputed(() =>
    buildItems(
      {
        sessions: store.sessions.value,
        live: store.live.value,
        pins: store.pins.value,
        renames: store.renames.value,
        here: store.here.value,
      },
      store.query.value,
      effectiveFilter(),
      Date.now(),
    ),
  ).value;
  const chatIdx = items.flatMap((it, i) => (it.kind === "chat" ? [i] : []));
  const activeItem = chatIdx[Math.min(active, chatIdx.length - 1)];
  const activeEntry = activeItem === undefined ? undefined : items[activeItem];
  const activeChatId = activeEntry?.kind === "chat" ? `chat-${activeEntry.vm.s.id}` : undefined;

  useEffect(() => setActive(0), [store.query.value, store.filter.value]);

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

  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, chatIdx.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && activeItem !== undefined) {
      const it = items[activeItem];
      if (it?.kind === "chat")
        post({ type: e.shiftKey ? "openTerminal" : "openChat", id: it.vm.s.id });
    } else if (e.key === "Escape") {
      store.query.value = "";
    }
  };

  const all = store.sessions.value;
  const hasWorkspace = store.env.value?.hasWorkspace ?? false;
  const liveCount = store.live.value.filter((l) => all.some((s) => s.id === l.sessionId)).length;

  let body: ComponentChildren;
  if (!store.loaded.value) {
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
        action={{ label: "Show all chats", onClick: () => (store.filter.value = "all") }}
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
              onRename={(on) => setRenaming(on ? it.vm.s.id : null)}
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
            placeholder="Search chats"
            aria-label="Search chats"
            aria-controls="chat-list"
            aria-activedescendant={activeChatId}
            value={store.query.value}
            onInput={(e) => (store.query.value = (e.target as HTMLInputElement).value)}
            onKeyDown={onSearchKey}
            onFocus={() => setKbd(true)}
            onBlur={() => setKbd(false)}
          />
          <kbd class="hint">/</kbd>
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
      </div>
      {body}
    </section>
  );
}
