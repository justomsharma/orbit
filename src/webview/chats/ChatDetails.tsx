import { useEffect, useRef, useState } from "preact/hooks";
import type { Turn } from "../../features/chats/conversation";
import type { ChangedFileView } from "../../shared/protocol";
import { post } from "../bus";
import * as store from "../store";
import { formatTokens } from "../ui/charts/format";
import { StatTile } from "../ui/charts/StatTile";
import { Empty } from "../ui/Empty";
import { Icon, IconButton } from "../ui/Icon";
import { showMenu } from "../ui/Menu";
import { Segmented } from "../ui/Segmented";
import { LIVE_LABEL, LIVE_TITLE, liveClass } from "./live";
import { rowMenu } from "./menu";
import { duration, relativeTime, toVMs } from "./model";

/**
 * Where a file is, shown relative to the chat's folder when it's inside it.
 * Only Windows folds case; either slash counts as a separator.
 */
function whereIs(path: string, cwd: string, platform: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = cut > 0 ? path.slice(0, cut) : "";
  const norm = (p: string) => {
    const n = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "win32" ? n.toLowerCase() : n;
  };
  const base = norm(cwd);
  if (!base) return dir;
  const d = norm(dir);
  if (d === base) return "";
  return d.startsWith(`${base}/`) ? dir.slice(base.length + 1) : dir;
}

const time = (at: number) =>
  at ? new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

function FileCard({ id, f, cwd }: { id: string; f: ChangedFileView; cwd: string }) {
  const where = whereIs(f.path, cwd, store.env.value?.platform ?? "linux");
  return (
    <li>
      <fieldset class="file-card">
        <legend class="sr-only">{f.name}</legend>
        <div class="file-head">
          <Icon name="file" />
          <span class="file-name" aria-hidden="true">
            {f.name}
          </span>
          {f.createdByClaude ? <span class="badge">New in this chat</span> : null}
          {!f.exists ? <span class="badge warn">Deleted since</span> : null}
        </div>
        {where ? <code class="srow-mono">{where}</code> : null}
        <ul class="versions">
          {f.versions.map((v, i) => {
            const created = f.createdByClaude && i === 0;
            const gone = !v.available;
            const why = gone ? "Claude no longer has this checkpoint" : undefined;
            return (
              <li key={v.version} class="version">
                <span class="version-label">
                  {created ? "Created by Claude" : `Before change ${v.version}`}
                  {v.at ? (
                    <span class="muted" title={time(v.at)}>
                      {" "}
                      · {relativeTime(v.at, store.now.value)}
                    </span>
                  ) : null}
                  {gone ? <span class="muted"> · no longer saved</span> : null}
                </span>
                {created ? null : (
                  <span class="version-actions">
                    <button
                      type="button"
                      class="btn small secondary"
                      disabled={gone}
                      title={why ?? "See what Claude changed since then"}
                      aria-label={`Compare ${f.name} before change ${v.version} with now`}
                      onClick={() =>
                        post({ type: "chat:diff", id, path: f.path, version: v.version })
                      }
                    >
                      Compare
                    </button>
                    <button
                      type="button"
                      class="btn small secondary"
                      disabled={gone}
                      title={why ?? "Put the file back to how it was (asks first, can be undone)"}
                      aria-label={`Restore ${f.name} to before change ${v.version}`}
                      onClick={() =>
                        post({ type: "chat:restore", id, path: f.path, version: v.version })
                      }
                    >
                      Restore
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
    </li>
  );
}

/** "Sep 8 at 3:04 PM" */
const startedAt = (t: number) =>
  `${new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;

let nextReq = 0;
const PAGE = 50;

/** Text with every match of `q` marked. */
function Marked({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: (string | preact.JSX.Element)[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    parts.push(text.slice(at, i), <mark key={i}>{text.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function TurnItem({ t, q, id }: { t: Turn; q: string; id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(t.text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 900);
      },
      () => {},
    );
  };
  const thinkingHit = !!q && !!t.thinking?.toLowerCase().includes(q);
  return (
    <li class={`turn ${t.role}`}>
      <div class="turn-head">
        <span class="turn-role">{t.role === "you" ? "You" : "Claude"}</span>
        {t.at ? (
          <span class="turn-time" title={new Date(t.at).toLocaleString()}>
            {new Date(t.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
        ) : null}
        <span class="turn-actions">
          <IconButton
            icon={copied ? "check" : "copy"}
            label={copied ? "Copied" : "Copy"}
            onClick={copy}
          />
          {t.role === "you" ? (
            <IconButton
              icon="debug-restart"
              label="Ask again in a new chat"
              onClick={() => post({ type: "chat:askAgain", id, text: t.text.slice(0, 10_000) })}
            />
          ) : null}
        </span>
      </div>
      {t.thinking ? (
        <details class="turn-thinking" open={thinkingHit}>
          <summary>Thinking</summary>
          <p>
            <Marked text={t.thinking} q={q} />
          </p>
        </details>
      ) : null}
      {t.text ? (
        <p class="turn-text">
          <Marked text={t.text} q={q} />
        </p>
      ) : null}
      {t.tools.length ? (
        <ul class="turn-tools">
          {t.tools.map((x, i) => (
            <li key={i}>
              <span class="tool-name">
                <Marked text={x.name} q={q} />
              </span>
              {x.arg ? (
                <code class="tool-arg">
                  <Marked text={x.arg} q={q} />
                </code>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {t.usage ? (
        <span class="turn-usage">
          {formatTokens(t.usage.output)} out · {formatTokens(t.usage.input)} in ·{" "}
          {formatTokens(t.usage.cache)} cache
        </span>
      ) : null}
    </li>
  );
}

/** The conversation: newest or oldest first, 50 at a time, or every match of a search. */
function Messages({ id }: { id: string }) {
  const [order, setOrder] = useState<"latest" | "earliest">("latest");
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [req, setReq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setAsked(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    const r = `c${++nextReq}`;
    setReq(r);
    post({ type: "chat:conversation", id, order, query: asked, limit, req: r });
  }, [id, order, asked, limit, store.sessions.value.find((s) => s.id === id)?.lastActiveAt]);
  const c = store.conversation.value;
  const page = c && c.id === id ? c.page : null;
  const stale = !c || c.req !== req;
  const q = asked.toLowerCase();
  return (
    <section class="messages" aria-labelledby="messages-title">
      <div class="messages-head">
        <h4 id="messages-title" class="subgroup-title">
          Messages{page ? ` (${page.total.toLocaleString()})` : ""}
        </h4>
        {page && page.total > PAGE ? (
          <Segmented<"latest" | "earliest">
            legend="Order"
            value={order}
            onChange={(v) => {
              setOrder(v);
              setLimit(PAGE);
            }}
            options={[
              { value: "latest", label: "Latest" },
              { value: "earliest", label: "Earliest" },
            ]}
          />
        ) : null}
      </div>
      <div class="search">
        <Icon name="search" />
        <input
          type="search"
          placeholder="Search this chat"
          aria-label="Search this chat"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
        {asked ? (
          <span class="search-count" aria-live="polite">
            {stale || !page ? "…" : `${page.matches ?? 0} found`}
          </span>
        ) : null}
      </div>
      {!page ? (
        <div class="loading" role="status">
          Reading the conversation…
        </div>
      ) : (
        <>
          <p class="messages-hint">
            {asked
              ? page.matches
                ? `${page.matches} message${page.matches === 1 ? "" : "s"} match, newest first`
                : "No matches."
              : `Showing ${order === "latest" ? "last" : "first"} ${Math.min(page.turns.length, page.total)} of ${page.total} messages${order === "latest" ? " · newest first" : ""}`}
          </p>
          <ul class="turns">
            {page.turns.map((t, i) => (
              <TurnItem key={`${t.at}-${i}`} t={t} q={q} id={id} />
            ))}
          </ul>
          {!asked && page.turns.length < page.total ? (
            <button
              type="button"
              class="btn secondary small"
              onClick={() => setLimit(limit + PAGE)}
            >
              Show more ({page.total - page.turns.length} remaining)
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function Stats({ id }: { id: string }) {
  const c = store.conversation.value;
  const st = c?.id === id ? c.page.stats : null;
  if (!st) return null;
  const tokens = st.tokens.input + st.tokens.output;
  return (
    <div class="tiles">
      <StatTile
        label={st.messages === 1 ? "message" : "messages"}
        value={formatTokens(st.messages)}
      />
      {st.tools ? (
        <StatTile label={st.tools === 1 ? "tool" : "tools"} value={formatTokens(st.tools)} />
      ) : null}
      {tokens ? (
        <StatTile
          label="tokens"
          value={formatTokens(tokens)}
          hint={`${formatTokens(st.tokens.input)} in · ${formatTokens(st.tokens.output)} out · ${formatTokens(st.tokens.cacheRead)} cache read · ${formatTokens(st.tokens.cacheWrite)} cache write`}
        />
      ) : null}
      <StatTile label="duration" value={duration(st.durationMs)} />
    </div>
  );
}

/** One chat: what it is, everything you can do with it, the files Claude changed, and the conversation. */
export function ChatDetails() {
  const d = store.details.value!;
  const vm = toVMs({
    sessions: store.sessions.value.filter((x) => x.id === d.id),
    live: store.live.value,
    pins: store.pins.value,
    renames: store.renames.value,
    here: store.here.value,
    tags: store.tags.value,
    archived: store.archived.value,
    hidden: store.hidden.value,
    temp: store.temp.value,
    terminals: store.terminals.value,
  })[0];
  const backRef = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  // Opening details moves focus here; going back returns it to the search box.
  useEffect(() => backRef.current?.focus(), []);
  const back = () => {
    store.focusSearch.value = true;
    store.details.value = null;
    store.conversation.value = null;
  };
  const inCheckpoints = store.tab.value === "checkpoints";
  if (!vm) {
    return (
      <section class="details">
        <button ref={backRef} type="button" class="back-btn" onClick={back}>
          <Icon name="arrow-left" /> {inCheckpoints ? "All checkpoints" : "All chats"}
        </button>
        <Empty icon="warning" title="That chat is gone">
          It's no longer on disk.
        </Empty>
      </section>
    );
  }
  const s = vm.s;
  const sub = s.firstPrompt && s.firstPrompt !== vm.title ? s.firstPrompt : "";
  const primary = vm.live
    ? { icon: "terminal", label: vm.linked ? "View" : "Running" }
    : { icon: "play", label: "Continue" };
  const otherFolder = !vm.here && store.env.value?.hasWorkspace;
  const saveName = () => {
    post({ type: "rename", id: s.id, title: draft.trim() === s.title ? "" : draft });
    setRenaming(false);
  };
  return (
    <section class="details scroll-y" aria-labelledby="details-title">
      <button
        ref={backRef}
        type="button"
        class="back-btn"
        aria-label={inCheckpoints ? "Back to checkpoints" : "Back to chats"}
        onClick={back}
      >
        <Icon name="arrow-left" /> {inCheckpoints ? "All checkpoints" : "All chats"}
      </button>
      {renaming ? (
        <input
          class="rename-input big"
          aria-label="New name"
          value={draft}
          maxLength={200}
          ref={(el) => el?.focus()}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveName();
            if (e.key === "Escape") setRenaming(false);
          }}
          onBlur={() => setRenaming(false)}
        />
      ) : (
        <h3 id="details-title" class="details-title">
          {vm.title}
        </h3>
      )}
      {sub ? <p class="details-sub">{sub}</p> : null}
      <div class="details-meta">
        {vm.live ? (
          <span class={`pill live ${liveClass(vm.live.status)}`} title={LIVE_TITLE[vm.live.status]}>
            <span class={`live-dot ${liveClass(vm.live.status)}`} aria-hidden="true" />
            {LIVE_LABEL[vm.live.status]}
          </span>
        ) : null}
        <span class="pill" title={s.cwd}>
          <Icon name="folder" /> {s.project}
        </span>
        {s.branch ? (
          <span class="pill mono">
            <Icon name="git-branch" /> {s.branch}
          </span>
        ) : null}
        <span class="details-date">· {startedAt(s.startedAt)}</span>
      </div>
      {s.worktree ? (
        <div class={`wt-card${s.worktree.removed ? " removed" : ""}`}>
          <div class="wt-title">
            {s.worktree.kind === "claude" ? "Worktree Claude made" : "Your worktree"}
            {s.worktree.removed ? <span class="badge warn">removed</span> : null}
          </div>
          <dl>
            <dt>Folder</dt>
            <dd>{s.cwd}</dd>
            <dt>Branch</dt>
            <dd>{s.branch ?? "(detached)"}</dd>
          </dl>
          {s.worktree.removed ? (
            <p class="card-hint">
              This worktree was removed from disk, so the chat can't continue there.
            </p>
          ) : null}
        </div>
      ) : null}
      {otherFolder ? (
        <p class="notice">
          <Icon name="info" /> This chat is from <b>{s.project}</b>.{" "}
          <button
            type="button"
            class="link-btn"
            onClick={() => post({ type: "chat:openFolder", id: s.id })}
          >
            Open {s.project}
          </button>
        </p>
      ) : null}
      <div class="details-actions">
        <button type="button" class="btn" onClick={() => post({ type: "openChat", id: s.id })}>
          <Icon name={primary.icon} /> {primary.label}
        </button>
        <button
          type="button"
          class="btn secondary"
          onClick={() => post({ type: "pin", id: s.id, on: !vm.pinned })}
        >
          <Icon name={vm.pinned ? "pinned" : "pin"} /> {vm.pinned ? "Unpin" : "Pin"}
        </button>
        <button
          type="button"
          class="btn secondary"
          title="Save this chat as a .jsonl file you can import anywhere"
          onClick={() => post({ type: "chat:save", ids: [s.id] })}
        >
          <Icon name="export" /> Export
        </button>
        <button
          type="button"
          class="icon-btn"
          title="More actions"
          aria-label={`More actions for ${vm.title}`}
          aria-haspopup="menu"
          onClick={(e) =>
            showMenu(
              [
                ...rowMenu(vm, () => {
                  setDraft(vm.title);
                  setRenaming(true);
                }).filter(
                  (m) =>
                    m.kind === "separator" ||
                    !["Files and transcript", "Pin to top", "Unpin"].includes(m.label),
                ),
                { kind: "separator" },
                {
                  label: "Read the transcript",
                  icon: "book",
                  run: () => post({ type: "chat:transcript", id: s.id }),
                },
              ],
              e.currentTarget as HTMLElement,
              `${vm.title} actions`,
            )
          }
        >
          <Icon name="ellipsis" />
        </button>
      </div>
      <Stats id={s.id} />
      <TagEditor id={s.id} />
      <h4 class="subgroup-title">Files Claude changed</h4>
      {d.files === null ? (
        <div class="loading" role="status">
          Reading what changed…
        </div>
      ) : d.files.length === 0 ? (
        <p class="muted">Claude didn't change any files in this chat.</p>
      ) : (
        <ul class="file-cards">
          {d.files.map((f) => (
            <FileCard key={f.path} id={d.id} f={f} cwd={s.cwd} />
          ))}
        </ul>
      )}
      <Messages id={s.id} />
    </section>
  );
}

export { openDetails } from "./open";

/** Orbit-only tags for a chat: shown on its row, found with #tag in search. */
function TagEditor({ id }: { id: string }) {
  const tags = store.tags.value[id] ?? [];
  const [draft, setDraft] = useState("");
  const save = (next: string[]) => post({ type: "tags", id, tags: next });
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    if (!tags.includes(t.toLowerCase())) save([...tags, t]);
  };
  return (
    <div class="tag-editor">
      {tags.map((t) => (
        <span key={t} class="chat-tag editable">
          #{t}
          <button
            type="button"
            class="tag-remove"
            aria-label={`Remove tag ${t}`}
            title="Remove"
            onClick={() => save(tags.filter((x) => x !== t))}
          >
            <Icon name="close" />
          </button>
        </span>
      ))}
      {tags.length >= 8 ? (
        <span class="muted">A chat can have up to 8 tags.</span>
      ) : (
        <input
          class="tag-input"
          aria-label="Add a tag"
          placeholder={tags.length ? "Add tag" : "Add a tag, e.g. bug"}
          maxLength={24}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          onBlur={add}
        />
      )}
    </div>
  );
}
