import type { ComponentChildren } from "preact";
import * as store from "../store";
import { Icon, IconButton } from "../ui/Icon";

/** Does every word of the search appear in any of the given texts? */
export function matches(query: string, ...texts: (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export const SCOPE_LABEL: Record<string, string> = {
  user: "You",
  project: "Project",
  "project-dir": "Project",
  local: "This folder",
  plugin: "Plugin",
  managed: "Organisation",
};

export const SCOPE_WORD: Record<string, string> = {
  user: "user",
  project: "shared project",
  local: "local project",
  managed: "managed",
};

/** Highest precedence first, as Claude Code applies settings files. */
export const PRECEDENCE = ["managed", "local", "project", "user"] as const;

/**
 * The value Claude uses for a setting (or one entry of an object setting such as
 * `skillOverrides`), and the file it comes from. Null when no file sets it.
 */
export function decided(key: string, entry?: string): { scope: string; value: unknown } | null {
  const files = store.setup.value?.settings ?? [];
  for (const scope of PRECEDENCE) {
    const v = files.find((f) => f.scope === scope)?.values[key];
    if (!v) continue;
    if (entry === undefined) {
      if ("value" in v) return { scope, value: v.value };
      return { scope, value: undefined };
    }
    if ("entries" in v && entry in v.entries) return { scope, value: v.entries[entry] };
  }
  return null;
}

export const LOCKED = "Set by your organisation's managed settings";

export function Badge({
  children,
  tone = "plain",
  title,
}: {
  children: ComponentChildren;
  tone?: "plain" | "warn" | "error" | "ok";
  title?: string;
}) {
  return (
    <span class={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

interface SectionProps {
  id: string;
  title: string;
  icon: string;
  count?: number;
  /** Shown next to the title, e.g. "2 need attention". */
  note?: string;
  children: ComponentChildren;
  /** Hidden entirely when searching and nothing inside matches. */
  hidden?: boolean;
}

/** A collapsible group. Searching opens every group that has matches. */
export function Section({ id, title, icon, count, note, children, hidden }: SectionProps) {
  if (hidden) return null;
  const searching = store.setupQuery.value.trim() !== "";
  const open = searching || store.openSections.value.includes(id);
  const toggle = () => {
    const s = new Set(store.openSections.value);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    store.openSections.value = [...s];
  };
  return (
    <fieldset class={`sec${open ? " open" : ""}`}>
      <legend>
        <button type="button" class="sec-head" aria-expanded={open} onClick={toggle}>
          <Icon name={open ? "chevron-down" : "chevron-right"} />
          <Icon name={icon} />
          <span class="sec-title">{title}</span>
          {count !== undefined ? <span class="sec-count">{count}</span> : null}
          {note ? <span class="sec-note">{note}</span> : null}
        </button>
      </legend>
      {open ? <div class="sec-body">{children}</div> : null}
    </fieldset>
  );
}

interface RowProps {
  title: string;
  sub?: string | null;
  mono?: string | null;
  badges?: ComponentChildren;
  actions?: ComponentChildren;
  onOpen?: () => void;
}

export function Row({ title, sub, mono, badges, actions, onOpen }: RowProps) {
  return (
    <li class="srow">
      <div class="srow-main">
        <div class="srow-title-line">
          <span class="srow-title">{title}</span>
          {badges}
        </div>
        {sub ? <div class="srow-sub">{sub}</div> : null}
        {mono ? <code class="srow-mono">{mono}</code> : null}
      </div>
      <div class="srow-actions">
        {actions}
        {onOpen ? <IconButton icon="go-to-file" label={`Open ${title}`} onClick={onOpen} /> : null}
      </div>
    </li>
  );
}

export function Switch({
  on,
  label,
  onChange,
  disabled = false,
}: {
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
  /** Locked by the organisation's managed settings. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={disabled ? `${label}: ${LOCKED}` : label}
      disabled={disabled}
      class={`switch${on ? " on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span class="switch-knob" />
    </button>
  );
}

export type EditScope = "user" | "project" | "local";

export function ScopeSelect({
  value,
  onChange,
  label = "Save to",
  allowLocal = true,
}: {
  value: EditScope;
  onChange: (s: EditScope) => void;
  label?: string;
  allowLocal?: boolean;
}) {
  const hasWorkspace = store.setup.value?.workspace != null;
  return (
    <label class="field inline">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value as EditScope)}
      >
        <option value="user">You (all projects)</option>
        {hasWorkspace ? <option value="project">Project (shared)</option> : null}
        {hasWorkspace && allowLocal ? <option value="local">This folder (just you)</option> : null}
      </select>
    </label>
  );
}

export function Field({
  label,
  value,
  onInput,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label class="field">
      <span>{label}</span>
      <input
        class={mono ? "mono" : undefined}
        value={value}
        placeholder={placeholder}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
    </label>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="sec-empty">{children}</p>;
}
