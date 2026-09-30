import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import type { MessageHit } from "../../features/chats/search";
import { post } from "../bus";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { IconButton } from "../ui/Icon";
import { openDetails } from "./ChatDetails";

let nextReq = 0;

/**
 * Searches inside messages a moment after typing stops, in the chats in view
 * only. Lives above the chat list so opening a chat's details and coming back
 * doesn't search again. Clearing the box stops a search still running.
 */
export function useMessageSearch(enabled: boolean, ids: string[]): void {
  const on = enabled && store.inMessages.value;
  const q = store.query.value.trim();
  const key = ids.join(",");
  useEffect(() => {
    if (!on || q.length < 2) {
      if (store.messageSearch.value) post({ type: "search", query: "", req: "cancel" });
      store.messageSearch.value = null;
      store.messageHits.value = null;
      return;
    }
    const cur = store.messageSearch.value;
    if (cur && cur.query === q && cur.key === key) return;
    const t = setTimeout(() => {
      const req = `search-${++nextReq}`;
      store.messageSearch.value = { req, query: q, key };
      store.messageHits.value = null;
      post({ type: "search", query: q, req, ids });
    }, 350);
    return () => clearTimeout(t);
  }, [on, q, key]);
}

/** Hits for the text in the box right now (never an older query's), in the chats asked about. */
export function currentHits(): MessageHit[] {
  const q = store.query.value.trim();
  const res = store.messageHits.value;
  const asked = store.messageSearch.value;
  if (!res?.done || asked?.query !== q) return [];
  const ids = new Set(asked.key.split(","));
  return res.hits.filter((h) => ids.has(h.sessionId));
}

/** The snippet with each case-insensitive match of the query marked. */
function highlight(text: string, q: string) {
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: (string | JSX.Element)[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); needle && i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) out.push(text.slice(at, i));
    out.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  out.push(text.slice(at));
  return out;
}

export function MessageResults({ active }: { active: number }) {
  const q = store.query.value.trim();
  const res = store.messageHits.value;
  const fresh = store.messageSearch.value?.query === q;
  if (q.length < 2)
    return (
      <Empty icon="search" title="Search inside your chats">
        Type at least two letters to search everything you and Claude wrote.
      </Empty>
    );
  if (!res?.done || !fresh)
    return (
      <div class="loading" role="status">
        {fresh && res?.total
          ? `Searched ${res.searched ?? 0} of ${res.total} chats…`
          : "Searching your chats…"}
      </div>
    );
  const hits = currentHits();
  if (!hits.length) return <Empty icon="search" title={`Nothing in these chats says "${q}"`} />;
  const byId = new Map(store.sessions.value.map((s) => [s.id, s]));
  return (
    <>
      {res.capped ? (
        <p class="toolbar-note hits-note">
          Showing the first 200 chats that match. Add words to narrow it down.
        </p>
      ) : null}
      <div class="hits" id="hit-list" role="listbox" aria-label="Found in messages">
        {hits.map((h, i) => {
          const s = byId.get(h.sessionId);
          const title = store.renames.value[h.sessionId] || s?.title || "Chat";
          return (
            <div
              key={h.sessionId}
              id={`hit-${h.sessionId}`}
              class={`hit${i === active ? " active" : ""}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
            >
              <button
                type="button"
                class="hit-main"
                tabIndex={-1}
                onClick={() => post({ type: "openChat", id: h.sessionId })}
              >
                <span class="chat-title">{title}</span>
                <span class="hit-snippet">{highlight(h.snippet, q)}</span>
                <span class="chat-meta">
                  {[s?.project, `${h.count} match${h.count === 1 ? "" : "es"}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
              <IconButton
                icon="history"
                label="Files and transcript"
                onClick={() => openDetails(h.sessionId)}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
