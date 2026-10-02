import { useEffect } from "preact/hooks";
import { post } from "../bus";
import { exactTime, relativeTime } from "../chats/model";
import * as store from "../store";
import { IconButton } from "../ui/Icon";
import { Empty, matches, Row, Section } from "./parts";

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Everything Orbit changed (each can be undone) and everything in its trash. */
export function HistorySection() {
  const q = store.setupQuery.value;
  // Read only once the section is opened (or a search looks inside it).
  const open = store.openSections.value.includes("history") || q.trim() !== "";
  useEffect(() => {
    if (open) post({ type: "history:list" });
  }, [open]);
  const h = store.history.value;
  const now = store.now.value;
  const rows = [
    ...(h?.edits ?? []).map((e) => ({ kind: "edit" as const, ...e, where: e.file })),
    ...(h?.trash ?? []).map((t) => ({ kind: "trash" as const, ...t, where: t.original })),
  ]
    .filter((r) => matches(q, r.label, r.where))
    .sort((a, b) => b.at - a.at);
  return (
    <Section
      id="history"
      title="Undo history"
      icon="history"
      count={rows.length}
      hidden={q.trim() !== "" && rows.length === 0}
    >
      {h === null ? (
        <p class="muted" role="status">
          Reading…
        </p>
      ) : rows.length ? (
        <ul class="srows">
          {rows.map((r) => (
            <Row
              key={r.id}
              title={r.label}
              sub={`${base(r.where)} · ${relativeTime(r.at, now)}`}
              mono={r.where}
              actions={
                r.kind === "edit" ? (
                  <button
                    type="button"
                    class="btn small secondary"
                    title={`Put ${base(r.where)} back as it was before (${exactTime(r.at)})`}
                    onClick={() => post({ type: "history:undo", id: r.id })}
                  >
                    Undo
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      class="btn small secondary"
                      title={`Put it back at ${r.where}`}
                      onClick={() => post({ type: "history:restore", id: r.id })}
                    >
                      Restore
                    </button>
                    <IconButton
                      icon="trash"
                      label={`Delete ${base(r.where)} for good`}
                      onClick={() => post({ type: "history:forget", id: r.id })}
                    />
                  </>
                )
              }
            />
          ))}
        </ul>
      ) : (
        <Empty>
          Nothing yet. Every change Orbit makes shows up here, so you can undo it later.
        </Empty>
      )}
    </Section>
  );
}
