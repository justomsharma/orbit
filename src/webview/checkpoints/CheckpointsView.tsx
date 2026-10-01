import { useState } from "preact/hooks";
import { ChatDetails, openDetails } from "../chats/ChatDetails";
import { relativeTime } from "../chats/model";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { Icon } from "../ui/Icon";

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

/** Every chat where Claude kept copies of files it changed: open one to compare or restore. */
export function CheckpointsView() {
  const [q, setQ] = useState("");
  if (store.details.value) {
    return (
      <div class="chats-tab">
        <ChatDetails />
      </div>
    );
  }
  const items = store.checkpoints.value;
  const byId = new Map(store.sessions.value.map((s) => [s.id, s]));
  const renames = store.renames.value;
  const now = store.now.value;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (items ?? [])
    .map((c) => ({ c, s: byId.get(c.id) }))
    .filter(({ s }) => s)
    .map(({ c, s }) => ({ c, s: s!, title: renames[c.id] || s!.title }))
    .filter(({ s, title }) => {
      const hay = `${title} ${s.project}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => b.s.lastActiveAt - a.s.lastActiveAt);

  return (
    <section class="checkpoints scroll">
      <div class="toolbar setup-toolbar">
        <div class="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search checkpoints"
            aria-label="Search checkpoints"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
            }}
          />
        </div>
      </div>
      {items === null ? (
        <div class="loading" role="status">
          Looking for checkpoints…
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
            {plural(rows.length, "chat")} with checkpoints · click one to compare or restore
          </p>
          <ul class="cp-list">
            {rows.map(({ c, s, title }) => (
              <li key={c.id}>
                <button type="button" class="cp-row" onClick={() => openDetails(c.id)}>
                  <span class="cp-title">{title}</span>
                  <span class="cp-time">{relativeTime(s.lastActiveAt, now)}</span>
                  <span class="cp-meta">
                    {[
                      s.project,
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
