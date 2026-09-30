import { useState } from "preact/hooks";
import type { ChangedFileView } from "../../shared/protocol";
import { post } from "../bus";
import * as store from "../store";
import { Icon } from "../ui/Icon";
import { relativeTime } from "./model";

/** Where a file is, shown relative to the chat's folder when it's inside it. */
function whereIs(path: string, cwd: string): string {
  const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  const base = cwd.replace(/[\\/]+$/, "").toLowerCase();
  if (!base) return dir;
  if (dir.toLowerCase() === base) return "";
  const inside =
    dir.slice(0, base.length).toLowerCase() === base && /[\\/]/.test(dir.charAt(base.length));
  return inside ? dir.slice(base.length + 1) : dir;
}

const time = (at: number) =>
  at ? new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

function FileCard({ id, f, cwd }: { id: string; f: ChangedFileView; cwd: string }) {
  const where = whereIs(f.path, cwd);
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
            const n = i + 1;
            const gone = !v.available;
            const why = gone ? "Claude no longer has this checkpoint" : undefined;
            return (
              <li key={v.version} class="version">
                <span class="version-label">
                  {created ? "Created by Claude" : `Before edit ${n}`}
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
                      aria-label={`Compare ${f.name} before edit ${n} with now`}
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
                      aria-label={`Restore ${f.name} to before edit ${n}`}
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

/** One chat's files, versions and transcript. */
export function ChatDetails() {
  const d = store.details.value!;
  const s = store.sessions.value.find((x) => x.id === d.id);
  const title = store.renames.value[d.id] || s?.title || "Chat";
  const back = () => (store.details.value = null);
  return (
    <section class="details" aria-labelledby="details-title">
      <div class="details-head">
        <button
          type="button"
          class="icon-btn"
          aria-label="Back to chats"
          title="Back"
          onClick={back}
        >
          <Icon name="arrow-left" />
        </button>
        <h3 id="details-title" class="details-title">
          {title}
        </h3>
      </div>
      <div class="details-actions">
        <button
          type="button"
          class="btn small"
          onClick={() => post({ type: "openChat", id: d.id })}
        >
          Continue chat
        </button>
        <button
          type="button"
          class="btn small secondary"
          onClick={() => post({ type: "chat:transcript", id: d.id })}
        >
          Read transcript
        </button>
        <button
          type="button"
          class="btn small secondary"
          onClick={() => post({ type: "chat:export", id: d.id })}
        >
          Export as Markdown
        </button>
        <button
          type="button"
          class="btn small secondary"
          title="Start a new chat from this one's history. This chat stays as it is."
          onClick={() => post({ type: "forkChat", id: d.id })}
        >
          Fork into a new chat
        </button>
      </div>
      <TagEditor id={d.id} />
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
            <FileCard key={f.path} id={d.id} f={f} cwd={s?.cwd ?? ""} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Opens a chat's details and asks the host for its changes. */
export function openDetails(id: string): void {
  store.details.value = { id, files: null };
  post({ type: "chat:details", id });
}

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
    </div>
  );
}
