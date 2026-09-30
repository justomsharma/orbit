import { useState } from "preact/hooks";
import type { SettingsView, SettingValue } from "../../extension/setupService";
import type { SettingDef } from "../../features/setup/catalog";
import { humanize } from "../../features/setup/hookEvents";
import { post } from "../bus";
import * as store from "../store";
import { Badge, type EditScope, matches, SCOPE_WORD, Section } from "./parts";

const PRECEDENCE = ["managed", "local", "project", "user"] as const;

/** Where the value Claude actually uses comes from (highest precedence first). */
function effective(files: SettingsView[], key: string): { scope: string; v: SettingValue } | null {
  for (const scope of PRECEDENCE) {
    const v = files.find((f) => f.scope === scope)?.values[key];
    if (v) return { scope, v };
  }
  return null;
}

/**
 * Settings Claude merges across files instead of taking only the highest one:
 * every list, plus these objects (Claude Code docs, "Settings precedence").
 */
const COMBINED = new Set(["permissions", "env", "enabledPlugins", "hooks", "skillOverrides"]);
const combines = (key: string, v: SettingValue) => COMBINED.has(key) || "count" in v;

const shown = (v: SettingValue | undefined): string =>
  !v
    ? ""
    : "value" in v
      ? String(v.value)
      : "hidden" in v
        ? "set (hidden)"
        : "count" in v
          ? `${v.count} item${v.count === 1 ? "" : "s"}`
          : "keys" in v
            ? v.keys.join(", ")
            : Object.keys(v.entries).join(", ");

function Control({
  def,
  scope,
  file,
}: {
  def: SettingDef;
  scope: EditScope;
  file: SettingsView | undefined;
}) {
  const current = file?.values[def.key];
  const plain = current && "value" in current ? current.value : undefined;
  const label = humanize(def.key);
  const set = (value: string | number | boolean | null) =>
    post({ type: "setup:setSetting", scope, key: def.key, value });
  const [draft, setDraft] = useState<string | null>(null);

  if (def.kind === "boolean") {
    return (
      <select
        aria-label={label}
        value={plain === true ? "on" : plain === false ? "off" : ""}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          set(v === "" ? null : v === "on");
        }}
      >
        <option value="">Claude's default</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    );
  }
  if (def.kind === "enum") {
    return (
      <select
        aria-label={label}
        value={typeof plain === "string" ? plain : ""}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          set(v === "" ? null : v);
        }}
      >
        <option value="">Claude's default</option>
        {(def.enum ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (def.kind === "string" || def.kind === "number") {
    if (current && "hidden" in current) return <span class="muted">Set (hidden)</span>;
    const value = draft ?? (plain === undefined ? "" : String(plain));
    const commit = () => {
      if (draft === null) return;
      const t = draft.trim();
      setDraft(null);
      if (t === "") set(null);
      else if (def.kind === "number") {
        const n = Number(t);
        if (Number.isFinite(n)) set(n);
      } else set(t);
    };
    const listId = def.suggestions?.length ? `sugg-${def.key}` : undefined;
    return (
      <>
        <input
          aria-label={label}
          type={def.kind === "number" ? "number" : "text"}
          value={value}
          placeholder="Claude's default"
          list={listId}
          min={def.minimum}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
        />
        {listId ? (
          <datalist id={listId}>
            {def.suggestions!.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        ) : null}
      </>
    );
  }
  return (
    <button
      type="button"
      class="btn small secondary"
      disabled={!file?.exists}
      title={file?.exists ? undefined : "This settings file doesn't exist yet"}
      onClick={() => file && post({ type: "setup:open", file: file.path })}
    >
      Edit in file
    </button>
  );
}

function SettingRow({ def, scope }: { def: SettingDef; scope: EditScope }) {
  const s = store.setup.value!;
  const file = s.settings.find((f) => f.scope === scope);
  const eff = effective(s.settings, def.key);
  const elsewhere = eff && eff.scope !== scope ? eff : null;
  const [more, setMore] = useState(false);
  return (
    <li class="setting">
      <div class="setting-head">
        <span class="setting-label">{humanize(def.key)}</span>
        {def.deprecated ? <Badge tone="warn">Deprecated</Badge> : null}
        <div class="setting-control">
          <Control def={def} scope={scope} file={file} />
        </div>
      </div>
      {elsewhere ? (
        <p class="setting-note">
          Set in {SCOPE_WORD[elsewhere.scope]} settings: {shown(elsewhere.v)}
          {combines(def.key, elsewhere.v)
            ? " (Claude combines the values from every file)"
            : PRECEDENCE.indexOf(elsewhere.scope as (typeof PRECEDENCE)[number]) <
                PRECEDENCE.indexOf(scope)
              ? " (that one wins)"
              : ""}
        </p>
      ) : null}
      {def.description ? (
        <button
          type="button"
          class={`setting-desc${more ? " open" : ""}`}
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          {def.description.replace(/\s*See https?:\/\/\S+/g, "")}
        </button>
      ) : null}
    </li>
  );
}

export function SettingsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const [scope, setScope] = useState<EditScope>("user");
  const [onlySet, setOnlySet] = useState(false);
  const setKeys = new Set(s.settings.flatMap((f) => Object.keys(f.values)));
  const defs = store.catalog.value.filter(
    (d) =>
      !d.managedOnly &&
      (!onlySet || setKeys.has(d.key)) &&
      matches(q, d.key, humanize(d.key), d.description, d.group),
  );
  const groups = [...new Set(defs.map((d) => d.group))];
  const hasWs = s.workspace != null;
  return (
    <Section
      id="settings"
      title="Settings"
      icon="settings"
      count={setKeys.size}
      note="set"
      hidden={q.trim() !== "" && defs.length === 0}
    >
      <fieldset class="segmented">
        <legend class="sr-only">Save settings to</legend>
        {(["user", ...(hasWs ? (["project", "local"] as const) : [])] as EditScope[]).map((sc) => (
          <label key={sc} class={scope === sc ? "on" : ""}>
            <input
              type="radio"
              name="settings-scope"
              class="sr-only"
              checked={scope === sc}
              onChange={() => setScope(sc)}
            />
            {sc === "user" ? "You" : sc === "project" ? "Project" : "This folder"}
          </label>
        ))}
      </fieldset>
      <label class="check">
        <input
          type="checkbox"
          checked={onlySet}
          onChange={(e) => setOnlySet((e.target as HTMLInputElement).checked)}
        />
        Only settings that are set
      </label>
      {groups.map((g) => (
        <div key={g} class="subgroup">
          <h4 class="subgroup-title">{g}</h4>
          <ul class="settings-list">
            {defs
              .filter((d) => d.group === g)
              .map((d) => (
                <SettingRow key={d.key} def={d} scope={scope} />
              ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}
