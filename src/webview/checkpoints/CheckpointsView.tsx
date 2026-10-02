import { useState } from "preact/hooks";
import type { ChangedFileView } from "../../shared/protocol";
import { post } from "../bus";
import { ChatDetails } from "../chats/ChatDetails";
import { exactTime, relativeTime } from "../chats/model";
import { openDetails } from "../chats/open";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { Icon, IconButton } from "../ui/Icon";

/** "1.2 MB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** What a chat with backups is called: its name, or its short id once the chat is gone. */
function label(id: string) {
  const s = store.sessions.value.find((x) => x.id === id);
  return {
    s,
    title: store.renames.value[id] || s?.title || `Chat ${id.slice(0, 8)}`,
    project: s?.project ?? "",
  };
}

/**
 * Every chat where Claude kept copies of files before changing them. Open one to
 * see its files, then a file to compare or put back any version.
 */
export function CheckpointsView() {
  if (store.details.value) {
    return (
      <div class="chats-tab">
        <ChatDetails />
      </div>
    );
  }
  const open = store.cpOpen.value;
  return open ? <ChatFiles id={open} /> : <ChatList />;
}

export function openChat(id: string) {
  store.cpOpen.value = id;
  store.cpFiles.value = null;
  post({ type: "cp:files", id });
}

function ChatList() {
  const [q, setQ] = useState("");
  const items = store.checkpoints.value;
  const now = store.now.value;
  const w = words(q);
  const rows = (items ?? [])
    .map((c) => {
      const l = label(c.id);
      return { c, ...l, at: c.newest || l.s?.lastActiveAt || 0 };
    })
    .filter((r) => {
      const hay = `${r.title} ${r.project} ${r.c.id}`.toLowerCase();
      return w.every((x) => hay.includes(x));
    })
    .sort((a, b) => b.at - a.at);

  return (
    <section class="checkpoints scroll">
      <div class="toolbar setup-toolbar">
        <div class="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search by chat, project or id"
            aria-label="Search checkpoints"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
            }}
          />
        </div>
        <IconButton icon="refresh" label="Refresh" onClick={() => post({ type: "refresh" })} />
      </div>
      {items === null ? (
        <div class="cp-skeleton">
          <div class="sr-only" role="status">
            Looking for checkpoints…
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} class="skeleton-row" aria-hidden="true" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        q ? (
          <Empty icon="search" title={`No checkpoints match "${q}"`} />
        ) : (
          <Empty icon="history" title="No checkpoints yet">
            When Claude edits a file it keeps a copy first. Those copies show up here, so you can
            compare or put back any version.
          </Empty>
        )
      ) : (
        <>
          <p class="page-count">
            {q
              ? `${rows.length} of ${plural(items.length, "chat")} with checkpoints`
              : `${plural(rows.length, "chat")} with checkpoints`}
          </p>
          <ul class="cp-list">
            {rows.map(({ c, s, title, project, at }) => (
              <li key={c.id}>
                <button type="button" class="cp-row" onClick={() => openChat(c.id)}>
                  <span class="cp-title">{title}</span>
                  <span class="cp-time" title={at ? exactTime(at) : undefined}>
                    {at ? relativeTime(at, now) : ""}
                  </span>
                  <span class="cp-meta">
                    {[
                      s ? project : "chat no longer on disk",
                      plural(c.files, "file"),
                      plural(c.versions, "version"),
                      formatBytes(c.bytes),
                    ].join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The folder a file is in, relative to the chat's folder when it's inside it. */
export function folderOf(path: string, cwd: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = cut > 0 ? path.slice(0, cut) : "";
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const base = norm(cwd);
  const d = norm(dir);
  if (base && d === base) return "top folder";
  if (base && d.startsWith(`${base}/`)) return dir.slice(cwd.replace(/[\\/]+$/, "").length + 1);
  return dir;
}

const latestAt = (f: ChangedFileView) => Math.max(0, ...f.versions.map((v) => v.at));

function ChatFiles({ id }: { id: string }) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const data = store.cpFiles.value?.id === id ? store.cpFiles.value : null;
  const { s, title, project } = label(id);
  const back = () => {
    store.cpOpen.value = null;
    store.cpFiles.value = null;
  };
  const w = words(q);
  const cwd = s?.cwd ?? "";
  const files = (data?.files ?? [])
    .map((f) => ({ f, dir: folderOf(f.path, cwd) }))
    .filter(({ f, dir }) => w.every((x) => `${f.name} ${dir}`.toLowerCase().includes(x)))
    .sort((a, b) => latestAt(b.f) - latestAt(a.f));

  return (
    <section class="checkpoints scroll" aria-labelledby="cp-title">
      <button type="button" class="back-btn" onClick={back}>
        <Icon name="arrow-left" /> All chats
      </button>
      <div class="cp-head">
        <div class="cp-head-text">
          <h3 id="cp-title" class="cp-head-title">
            {title}
          </h3>
          {project ? <span class="cp-meta">{project}</span> : null}
        </div>
        {s ? (
          <button type="button" class="btn small secondary" onClick={() => openDetails(id)}>
            Open chat
          </button>
        ) : null}
      </div>
      {data === null ? (
        <div class="cp-skeleton">
          <div class="sr-only" role="status">
            Reading the files Claude changed…
          </div>
          {[0, 1].map((i) => (
            <div key={i} class="skeleton-row" aria-hidden="true" />
          ))}
        </div>
      ) : data.gone ? (
        <Empty icon="history" title="This chat is no longer on disk">
          {data.orphans === 1 ? "1 backup is left" : `${data.orphans} backups are left`} from it.
          Without the chat, Orbit can't tell which file each one belongs to, so they can't be
          restored here. Claude removes old backups on its own schedule.
        </Empty>
      ) : (
        <>
          <div class="toolbar setup-toolbar">
            <div class="search">
              <Icon name="search" />
              <input
                type="search"
                placeholder="Search by file or folder"
                aria-label="Search files"
                value={q}
                onInput={(e) => setQ((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  if (q) setQ("");
                  else back();
                }}
              />
            </div>
          </div>
          <p class="page-count">
            {`${files.length} of ${plural(data.files.length, "file")}`}
            {data.orphans ? ` · ${plural(data.orphans, "backup")} no file explains` : ""}
          </p>
          {files.length === 0 ? (
            q ? (
              <Empty icon="search" title={`No files match "${q}"`} />
            ) : (
              <Empty icon="file" title="No files to show">
                Claude kept backups in this chat, but the chat doesn't say which files they're for.
              </Empty>
            )
          ) : (
            <ul class="cp-list">
              {files.map(({ f, dir }) => (
                <FileRow
                  key={f.path}
                  id={id}
                  f={f}
                  dir={dir}
                  open={expanded === f.path}
                  toggle={() => setExpanded(expanded === f.path ? null : f.path)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function FileRow(props: {
  id: string;
  f: ChangedFileView;
  dir: string;
  open: boolean;
  toggle: () => void;
}) {
  const { id, f, dir, open } = props;
  const now = store.now.value;
  const gone = f.versions.filter((v) => !v.available).length;
  const latest = latestAt(f);
  const listId = `cp-v-${f.path}`;
  return (
    <li class={`cp-file${open ? " open" : ""}`}>
      <button
        type="button"
        class="cp-row"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={props.toggle}
      >
        <span class="cp-title" title={f.path}>
          <Icon name={open ? "chevron-down" : "chevron-right"} /> {f.name}
          {f.createdByClaude ? <span class="badge">New</span> : null}
          {f.exists ? null : <span class="badge warn">Deleted since</span>}
        </span>
        <span class="cp-time" title={latest ? exactTime(latest) : undefined}>
          {latest ? relativeTime(latest, now) : ""}
        </span>
        <span class="cp-meta">
          {[dir, plural(f.versions.length, "version"), ...(gone ? [`${gone} no longer saved`] : [])]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </button>
      {open ? (
        <div class="cp-versions" id={listId}>
          <button
            type="button"
            class="btn small secondary"
            disabled={!f.exists}
            title={f.exists ? f.path : "It's been deleted. Restore a version to bring it back."}
            onClick={() => post({ type: "cp:openFile", id, path: f.path })}
          >
            <Icon name="go-to-file" /> Open current file
          </button>
          <ul class="versions" aria-label={`Versions of ${f.name}`}>
            {[...f.versions].reverse().map((v) => {
              const created = f.createdByClaude && v.version === f.versions[0]!.version;
              const missing = !v.available;
              const why = missing ? "Claude no longer has this checkpoint" : undefined;
              return (
                <li key={v.version} class={`version${missing ? " missing" : ""}`}>
                  <span class="version-label">
                    {created ? "Created by Claude" : `Before change ${v.version}`}
                    <span class="muted">
                      {v.at ? (
                        <span title={exactTime(v.at)}> · {relativeTime(v.at, now)}</span>
                      ) : null}
                      {missing ? " · no longer saved" : v.bytes ? ` · ${formatBytes(v.bytes)}` : ""}
                    </span>
                  </span>
                  {created ? null : (
                    <span class="version-actions">
                      <button
                        type="button"
                        class="btn small secondary"
                        disabled={missing}
                        title={why ?? `Compare with the current ${f.name}`}
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
                        disabled={missing}
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
        </div>
      ) : null}
    </li>
  );
}
