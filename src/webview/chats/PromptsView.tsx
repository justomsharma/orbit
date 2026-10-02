import type { ComponentChildren } from "preact";
import type { PromptEntry } from "../../features/prompts/library";
import { post } from "../bus";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { Icon, IconButton } from "../ui/Icon";
import { Loading } from "../ui/Loading";
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

/** "2 pasted · 300 lines", read from Claude's "[Pasted text #1 +290 lines]" placeholders. */
export function pasteNote(p: Pick<PromptEntry, "text" | "pastes">): string | null {
  if (!p.pastes) return null;
  let lines = 0;
  for (const m of p.text.matchAll(/\[Pasted text #\d+ \+(\d+) lines?\]/g)) lines += Number(m[1]);
  return `${p.pastes} pasted${lines ? ` · ${lines} line${lines === 1 ? "" : "s"}` : ""}`;
}

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
    pasteNote(p),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      class="prompt-row"
      data-row="prompt"
      title={p.text.length > 300 ? `${p.text.slice(0, 300)}…` : p.text}
    >
      {chatKnown ? (
        <button
          type="button"
          class="prompt-main as-button"
          title="Open the chat it came from"
          onClick={() => post({ type: "openChat", id: p.sessionId! })}
        >
          <span class="prompt-text">{p.text}</span>
          <span class="chat-meta">{meta}</span>
        </button>
      ) : (
        <div class="prompt-main">
          <div class="prompt-text">{p.text}</div>
          <div class="chat-meta">{meta}</div>
        </div>
      )}
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
  const project = store.promptProject.value;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = (all ?? []).filter(
    (p) => (!project || p.project === project) && (!words.length || matches(p, words)),
  );
  const projects = new Map<string, number>();
  for (const p of all ?? [])
    if (p.project) projects.set(p.project, (projects.get(p.project) ?? 0) + 1);
  const projectList = [...projects].sort(
    (a, b) => b[1] - a[1] || (folderName(a[0]) ?? "").localeCompare(folderName(b[0]) ?? ""),
  );
  const filtered = !!project || words.length > 0;
  const now = store.now.value;

  let body: ComponentChildren;
  if (all === null) {
    body = <Loading text="Reading your prompts…" retry={{ type: "prompts:list" }} />;
  } else if (store.promptsError.value) {
    body = (
      <Empty icon="warning" title="Couldn't read your prompts">
        {store.promptsError.value}
      </Empty>
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
        title={q ? `No prompts match "${q}"` : "No prompts in this project"}
        action={{
          label: "Show all",
          onClick: () => {
            store.promptQuery.value = "";
            store.promptProject.value = "";
          },
        }}
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
        {projectList.length > 1 ? (
          <select
            class="prompt-project"
            aria-label="Project"
            value={project}
            onChange={(e) => (store.promptProject.value = (e.target as HTMLSelectElement).value)}
          >
            <option value="">All projects ({all?.length ?? 0})</option>
            {projectList.map(([path, n]) => (
              <option key={path} value={path} title={path}>
                {folderName(path)} ({n})
              </option>
            ))}
          </select>
        ) : null}
        {all?.length ? (
          <p class="toolbar-note">
            {filtered
              ? `${list.length} of ${all.length} prompts`
              : `${all.length} different prompt${all.length === 1 ? "" : "s"}, most recent first`}
          </p>
        ) : null}
      </div>
      {body}
    </>
  );
}
