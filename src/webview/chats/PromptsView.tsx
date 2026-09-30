import type { ComponentChildren } from "preact";
import type { PromptEntry } from "../../features/prompts/library";
import { post } from "../bus";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { Icon, IconButton } from "../ui/Icon";
import { VirtualList } from "../ui/VirtualList";
import { relativeTime } from "./model";

const ROW_H = 72;

const folderName = (p: string | null) =>
  p
    ? (p
        .split(/[\\/]+/)
        .filter(Boolean)
        .pop() ?? p)
    : null;

function matches(p: PromptEntry, words: string[]): boolean {
  const hay = `${p.text} ${p.project ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function PromptRow({ p, now }: { p: PromptEntry; now: number }) {
  const chatKnown = p.sessionId !== null && store.sessions.value.some((s) => s.id === p.sessionId);
  const meta = [
    folderName(p.project),
    relativeTime(p.last, now),
    p.count > 1 ? `used ${p.count}×` : null,
    p.pastes ? `${p.pastes} pasted` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      class="prompt-row"
      data-row="prompt"
      title={p.text.length > 300 ? `${p.text.slice(0, 300)}…` : p.text}
    >
      <div class="prompt-main">
        <div class="prompt-text">{p.text}</div>
        <div class="chat-meta">{meta}</div>
      </div>
      <div class="chat-actions">
        <IconButton
          icon="comment-discussion"
          label="Use again in a new chat"
          onClick={() => post({ type: "prompts:use", id: p.id })}
        />
        <IconButton
          icon="copy"
          label="Copy prompt"
          onClick={() => post({ type: "prompts:copy", id: p.id })}
        />
        {chatKnown ? (
          <IconButton
            icon="go-to-file"
            label="Open the chat it came from"
            onClick={() => post({ type: "openChat", id: p.sessionId! })}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Every prompt you've typed, repeats collapsed, ready to use again. */
export function PromptsView() {
  const all = store.prompts.value;
  const q = store.promptQuery.value;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = all ? (words.length ? all.filter((p) => matches(p, words)) : all) : [];
  const now = store.now.value;

  let body: ComponentChildren;
  if (all === null) {
    body = (
      <div class="loading" role="status">
        Reading your prompts…
      </div>
    );
  } else if (all.length === 0) {
    body = (
      <Empty icon="history" title="No prompts yet">
        Prompts you type in Claude Code's terminal show up here, ready to use again.
      </Empty>
    );
  } else if (list.length === 0) {
    body = (
      <Empty
        icon="search"
        title={`No prompts match "${q}"`}
        action={{ label: "Clear search", onClick: () => (store.promptQuery.value = "") }}
      />
    );
  } else {
    body = (
      <VirtualList
        items={list}
        itemKey={(p) => p.id}
        height={() => ROW_H}
        label="Prompts"
        id="prompt-list"
        render={(p) => <PromptRow p={p} now={now} />}
      />
    );
  }

  return (
    <>
      <div class="toolbar">
        <div class="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search prompts"
            aria-label="Search prompts"
            value={q}
            onInput={(e) => (store.promptQuery.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") store.promptQuery.value = "";
            }}
          />
        </div>
        {all?.length ? (
          <p class="toolbar-note">
            {all.length} different prompt{all.length === 1 ? "" : "s"}, most recent first
          </p>
        ) : null}
      </div>
      {body}
    </>
  );
}
