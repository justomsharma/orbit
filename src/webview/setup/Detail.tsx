import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Tab } from "../../shared/tabs";
import { post } from "../bus";
import * as store from "../store";
import { Icon } from "../ui/Icon";

export const openDetail = (page: Tab, key: string) => {
  store.setupContent.value = null;
  store.setupDetail.value = { page, key };
};

export const closeDetail = () => {
  store.setupDetail.value = null;
  store.setupContent.value = null;
};

/** One skill, agent, command, hook, plugin, memory or server, on a page of its own. */
export function DetailPage(props: {
  back: string;
  title: string;
  sub?: string | null;
  badges?: ComponentChildren;
  actions?: ComponentChildren;
  children?: ComponentChildren;
}) {
  return (
    <section class="setup scroll detail-page" aria-labelledby="detail-title">
      <button type="button" class="back-btn" onClick={closeDetail}>
        <Icon name="arrow-left" /> {props.back}
      </button>
      <div class="detail-head">
        <h3 id="detail-title" class="detail-title">
          {props.title}
        </h3>
        {props.badges ? <div class="detail-badges">{props.badges}</div> : null}
        {props.sub ? <p class="detail-sub">{props.sub}</p> : null}
      </div>
      {props.actions ? <div class="detail-actions">{props.actions}</div> : null}
      {props.children}
    </section>
  );
}

/** When the item was removed while its page was open. */
export function Gone({ back, what }: { back: string; what: string }) {
  return (
    <DetailPage back={back} title={what}>
      <p class="muted">This {what} isn't there any more. It may have been deleted or moved.</p>
    </DetailPage>
  );
}

/** A labelled list of facts; rows without a value are left out. */
export function Info({
  label,
  rows,
}: {
  label: string;
  rows: [string, ComponentChildren | null | undefined | false][];
}) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "");
  if (!shown.length) return null;
  return (
    <section class="detail-block" aria-label={label}>
      <h4 class="subgroup-title">{label}</h4>
      <dl class="info-list">
        {shown.map(([k, v]) => (
          <div key={k} class="info-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Problems({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul class="detail-problems" aria-label="Things to check">
      {items.map((p) => (
        <li key={p}>
          <span class="detail-problem-icon">
            <Icon name="warning" />
          </span>{" "}
          {p}
        </li>
      ))}
    </ul>
  );
}

export function Chips({ items, label }: { items: string[]; label: string }) {
  if (!items.length) return null;
  return (
    <ul class="tags" aria-label={label}>
      {items.map((t) => (
        <li key={t} class="tag">
          {t}
        </li>
      ))}
    </ul>
  );
}

/** The file's text, read by the host when the page opens. */
export function FileText({ file, title = "Content" }: { file: string; title?: string }) {
  useEffect(() => {
    post({ type: "setup:read", file });
  }, [file]);
  const c = store.setupContent.value?.file === file ? store.setupContent.value : null;
  return (
    <section class="detail-block" aria-label={title}>
      <h4 class="subgroup-title">{title}</h4>
      {c === null ? (
        <p class="muted" role="status">
          Reading…
        </p>
      ) : c.text === null ? (
        <p class="muted">
          {c.truncated
            ? "This file is too large to show here (or couldn't be read). Open it to see it."
            : "Couldn't read this file."}
        </p>
      ) : (
        <pre class="file-text">{c.text}</pre>
      )}
    </section>
  );
}

/** Copies `text`, then says "Copied" for a second. */
export function CopyButton({
  text,
  label,
  icon = true,
  children,
}: {
  text: string;
  label: string;
  icon?: boolean;
  children?: ComponentChildren;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1000);
    return () => clearTimeout(t);
  }, [done]);
  const copy = (e: Event) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(text).then(() => setDone(true));
  };
  return children ? (
    <button type="button" class="btn small secondary" aria-label={label} onClick={copy}>
      <Icon name={done ? "check" : "copy"} /> {done ? "Copied" : children}
    </button>
  ) : (
    <button type="button" class="icon-btn" title={label} aria-label={label} onClick={copy}>
      {icon ? <Icon name={done ? "check" : "copy"} /> : null}
      {done ? <span class="copied">Copied</span> : null}
    </button>
  );
}
