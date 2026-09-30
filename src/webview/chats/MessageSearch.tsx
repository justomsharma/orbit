import { useEffect } from "preact/hooks";
import { post } from "../bus";
import * as store from "../store";
import { Empty } from "../ui/Empty";
import { IconButton } from "../ui/Icon";
import { openDetails } from "./ChatDetails";

let nextReq = 0;

/** Searches inside messages a moment after typing stops; only the latest answer is shown. */
export function useMessageSearch(): void {
  const on = store.inMessages.value;
  const q = store.query.value.trim();
  useEffect(() => {
    if (!on || q.length < 2) {
      store.messageSearch.value = null;
      store.messageHits.value = null;
      return;
    }
    const t = setTimeout(() => {
      const req = `search-${++nextReq}`;
      store.messageSearch.value = { req, query: q };
      store.messageHits.value = null;
      post({ type: "search", query: q, req });
    }, 350);
    return () => clearTimeout(t);
  }, [on, q]);
}

export function MessageResults() {
  const q = store.query.value.trim();
  const res = store.messageHits.value;
  if (q.length < 2)
    return (
      <Empty icon="search" title="Search inside your chats">
        Type at least two letters to search everything you and Claude wrote.
      </Empty>
    );
  if (!res)
    return (
      <div class="loading" role="status">
        Searching your chats…
      </div>
    );
  if (!res.hits.length) return <Empty icon="search" title={`Nothing in your chats says "${q}"`} />;
  const byId = new Map(store.sessions.value.map((s) => [s.id, s]));
  return (
    <ul class="hits" aria-label="Found in messages">
      {res.hits.map((h) => {
        const s = byId.get(h.sessionId);
        const title = store.renames.value[h.sessionId] || s?.title || "Chat";
        return (
          <li key={h.sessionId} class="hit">
            <button
              type="button"
              class="hit-main"
              onClick={() => post({ type: "openChat", id: h.sessionId })}
            >
              <span class="chat-title">{title}</span>
              <span class="hit-snippet">{h.snippet}</span>
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
          </li>
        );
      })}
    </ul>
  );
}
