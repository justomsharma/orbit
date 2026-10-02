import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { modelLabel } from "../../core/pricing";
import { MODE_LABELS } from "../../features/setup/risk";
import type { ViewMsg } from "../../shared/protocol";
import { ALWAYS_SHOWN, arrangeTabs, type Tab, tabDef } from "../../shared/tabs";
import { post } from "../bus";
import * as store from "../store";
import { Icon } from "../ui/Icon";
import { Loading } from "../ui/Loading";
import { HealthSection } from "./HealthSection";
import { HistorySection } from "./HistorySection";
import { PermissionsSection } from "./PermissionsSection";
import { decided, LOCKED, matches } from "./parts";
import { SettingsSection } from "./SettingsSection";
import { SetupToolbar } from "./SetupPage";

type Value = string | number | boolean;

/** The value Claude uses and where it comes from, for a plain or nested key. */
function current(key: string): { scope: string; value: Value | undefined } | null {
  if (key.includes(".")) return store.setup.value?.nested[key] ?? null;
  const d = decided(key);
  return d ? { scope: d.scope, value: d.value as Value | undefined } : null;
}

const set = (key: string, value: Value | null) =>
  post({ type: "setup:setSetting", scope: "auto", key, value, quick: true });

/**
 * Shows a choice straight away while the host saves it. It gives way to the saved
 * value as soon as that arrives, or after a few seconds (the change was cancelled).
 */
function usePending<T>(saved: T): [T, (v: T) => void] {
  const [pending, setPending] = useState<{ v: T } | null>(null);
  useEffect(() => setPending(null), [saved]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 10_000);
    return () => clearTimeout(t);
  }, [pending]);
  return [pending ? pending.v : saved, (v) => setPending({ v })];
}

const WHERE_NOTE: Record<string, string> = {
  local: "Set for this folder only",
  project: "Set for this project",
};

function Note({ scope }: { scope?: string }) {
  if (!scope || !(scope in WHERE_NOTE)) return null;
  return <span class="q-where">{WHERE_NOTE[scope]}</span>;
}

interface Choice {
  value: string;
  label: string;
  hint?: string;
}

function Pick({
  k,
  label,
  choices,
  fallbackHint,
}: {
  k: string;
  label: string;
  /** The first choice ("") means Claude's default: the key is removed. */
  choices: Choice[];
  fallbackHint?: string;
}) {
  const c = current(k);
  const locked = c?.scope === "managed";
  const [v, show] = usePending(c?.value === undefined ? "" : String(c.value));
  const all = choices.some((x) => x.value === v) ? choices : [...choices, { value: v, label: v }];
  const hint = all.find((x) => x.value === v)?.hint ?? fallbackHint;
  return (
    <div class="q-row">
      <label class="q-label" for={`q-${k}`}>
        {label}
      </label>
      <select
        id={`q-${k}`}
        class="q-select"
        value={v}
        disabled={locked}
        title={locked ? LOCKED : undefined}
        onChange={(e) => {
          const next = (e.target as HTMLSelectElement).value;
          show(next);
          set(k, next === "" ? null : next);
        }}
      >
        {all.map((x) => (
          <option key={x.value} value={x.value}>
            {x.label}
          </option>
        ))}
      </select>
      {hint ? <p class="q-hint">{hint}</p> : null}
      <Note scope={c?.scope} />
    </div>
  );
}

function Check({
  k,
  label,
  hint,
  defaultOn,
  onValue = true,
}: {
  k: string;
  label: string;
  hint: string;
  /** Claude's own default; matching it removes the key instead of writing it. */
  defaultOn: boolean;
  /** What "on" is written as (for example "disable" for the bypass block). */
  onValue?: Value;
}) {
  const c = current(k);
  const locked = c?.scope === "managed";
  const [on, show] = usePending(c?.value === undefined ? defaultOn : c.value === onValue);
  return (
    <div class="q-row">
      <label class="q-check" title={locked ? LOCKED : undefined}>
        <input
          type="checkbox"
          checked={on}
          disabled={locked}
          onChange={(e) => {
            const want = (e.target as HTMLInputElement).checked;
            show(want);
            // Set by a project file: write the choice out, so it wins over that file.
            const overridden = c?.scope === "project" || c?.scope === "local";
            const value = want ? onValue : onValue === true ? false : null;
            set(k, want === defaultOn && !overridden ? null : value);
          }}
        />
        {label}
      </label>
      <p class="q-hint">{hint}</p>
      <Note scope={c?.scope} />
    </div>
  );
}

function Days({ k, label, hint }: { k: string; label: string; hint: string }) {
  const c = current(k);
  const saved = typeof c?.value === "number" ? String(c.value) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? saved;
  const n = Number(shown);
  const valid = shown === "" || (Number.isInteger(n) && n >= 1 && n <= 3650);
  const save = () => {
    if (draft === null || !valid || draft === saved) return setDraft(null);
    set(k, draft === "" ? null : n);
    setDraft(null);
  };
  return (
    <div class="q-row">
      <label class="q-label" for={`q-${k}`}>
        {label}
      </label>
      <input
        id={`q-${k}`}
        class="q-input"
        inputMode="numeric"
        placeholder="30 (Claude's default)"
        value={shown}
        disabled={c?.scope === "managed"}
        aria-invalid={!valid}
        onInput={(e) => setDraft((e.target as HTMLInputElement).value.trim())}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <p class="q-hint">{valid ? hint : "A whole number of days, 1 or more."}</p>
      <Note scope={c?.scope} />
    </div>
  );
}

/** Claude's own trailer, nothing, or your text, for commits or pull requests. */
function Attribution({ k, label }: { k: "attribution.commit" | "attribution.pr"; label: string }) {
  const c = current(k);
  const locked = c?.scope === "managed";
  const saved = c?.value === undefined ? null : String(c.value);
  const savedMode = saved === null ? "default" : saved === "" ? "none" : "custom";
  const [mode, setMode] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const shownMode = mode ?? savedMode;
  const text = draft ?? (savedMode === "custom" ? (saved ?? "") : "");
  const id = `q-${k}`;
  const saveText = () => {
    if (draft?.trim() && draft !== saved) set(k, draft);
    setDraft(null);
  };
  return (
    <div class="q-row">
      <label class="q-label" for={id}>
        {label}
      </label>
      <select
        id={id}
        class="q-select"
        value={shownMode}
        disabled={locked}
        title={locked ? LOCKED : undefined}
        onChange={(e) => {
          const next = (e.target as HTMLSelectElement).value;
          setMode(next);
          if (next === "default") set(k, null);
          if (next === "none") set(k, "");
        }}
      >
        <option value="default">Claude's default</option>
        <option value="none">Add nothing</option>
        <option value="custom">Your own text…</option>
      </select>
      {shownMode === "custom" ? (
        <input
          class="q-input"
          aria-label={`${label} text`}
          placeholder="Generated with Claude Code"
          value={text}
          disabled={locked}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onBlur={saveText}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveText();
            if (e.key === "Escape") setDraft(null);
          }}
        />
      ) : null}
      <p class="q-hint">
        {shownMode === "none"
          ? "Nothing about Claude is added."
          : shownMode === "custom"
            ? "Replaces Claude's line. Saved when you leave the box."
            : "Claude adds its usual co-author line."}
      </p>
      <Note scope={c?.scope} />
    </div>
  );
}

/** The old `includeCoAuthoredBy` key, if a file still has it: attribution replaces it. */
function LegacyCoAuthor() {
  const files = store.setup.value?.settings ?? [];
  const f = files.find((x) => x.scope !== "managed" && x.values.includeCoAuthoredBy);
  if (!f) return null;
  return (
    <div class="q-row q-notice" role="note">
      <p class="q-hint">
        Your {f.scope === "user" ? "user" : f.scope} settings still have the old includeCoAuthoredBy
        setting. Claude uses the attribution settings above instead.
      </p>
      <button
        type="button"
        class="btn small secondary"
        onClick={() =>
          post({
            type: "setup:setSetting",
            scope: f.scope as "user",
            key: "includeCoAuthoredBy",
            value: null,
          })
        }
      >
        Remove the old setting
      </button>
    </div>
  );
}

function StatusLineRow() {
  const c = current("statusLine");
  const shown = c
    ? c.scope === "user"
      ? "Your own command"
      : `Set in ${c.scope} settings`
    : "Not set";
  return (
    <div class="q-row">
      <span class="q-label">Status line</span>
      <p class="q-hint">{shown}. Orbit's plan limits can sit on top of yours (see Account).</p>
      <button
        type="button"
        class="btn small secondary"
        onClick={() => post({ type: "setup:run", what: "slashStatusline" })}
      >
        Change in /statusline
      </button>
    </div>
  );
}

function ConfigActions() {
  const user = store.setup.value?.settings.find((f) => f.scope === "user");
  return (
    <div class="q-actions">
      {user?.exists ? (
        <button
          type="button"
          class="btn small secondary"
          onClick={() => post({ type: "setup:open", file: user.path })}
        >
          Open settings.json
        </button>
      ) : null}
      <button
        type="button"
        class="btn small secondary"
        title="Claude Code's own settings screen, in a terminal"
        onClick={() => post({ type: "setup:run", what: "slashConfig" })}
      >
        Open /config
      </button>
      <button
        type="button"
        class="btn small secondary"
        onClick={() => post({ type: "openOrbitSettings" })}
      >
        Orbit's settings
      </button>
      {user?.exists ? (
        <button
          type="button"
          class="btn small secondary danger"
          title="Clears your user settings; Orbit keeps a backup and Undo puts them back"
          onClick={() => post({ type: "setup:resetUserSettings" })}
        >
          Reset settings…
        </button>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="q-group" aria-label={title}>
      <h3 class="q-title">{title}</h3>
      {children}
    </section>
  );
}

const EFFORT: Choice[] = [
  { value: "", label: "Default", hint: "Each model picks its own effort" },
  { value: "low", label: "Low", hint: "Quick answers, fewest tokens" },
  { value: "medium", label: "Medium", hint: "A bit more thought" },
  { value: "high", label: "High", hint: "Careful reasoning for real work" },
  { value: "xhigh", label: "Extra high", hint: "Deep reasoning: slower, more tokens" },
];

const STYLES: Choice[] = [
  { value: "", label: "Default", hint: "Claude's usual way of answering" },
  { value: "Explanatory", label: "Explanatory", hint: "Explains its choices as it works" },
  { value: "Learning", label: "Learning", hint: "Leaves small parts for you to write" },
  { value: "Proactive", label: "Proactive", hint: "Takes the next obvious step on its own" },
];

/** The settings people change most, in plain words, one click each. */
function QuickSettings() {
  const s = store.setup.value!;
  const latest = [...store.sessions.value]
    .filter((x) => x.model)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]?.model;
  const models: Choice[] = [
    {
      value: "",
      label: latest ? `Default (${modelLabel(latest)})` : "Default",
      hint: "Claude Code picks the best model for your plan",
    },
    ...s.modelOptions.map((m) => ({ value: m.value, label: m.label, hint: m.description })),
  ];
  const model = current("model")?.value;
  if (typeof model === "string" && model && !models.some((m) => m.value === model))
    models.push({ value: model, label: modelLabel(model), hint: "Set in your settings" });
  const modes: Choice[] = [
    { value: "", label: "Default (ask before acting)" },
    ...Object.entries(MODE_LABELS).map(([value, label]) => ({ value, label })),
  ];
  return (
    <div class="quick">
      <Group title="Model & thinking">
        <Pick k="model" label="Model" choices={models} />
        <Pick k="effortLevel" label="Reasoning effort" choices={EFFORT} />
        <Check
          k="alwaysThinkingEnabled"
          label="Extended thinking"
          hint="Lets Claude think before it answers. Off turns thinking off in every chat."
          defaultOn
        />
      </Group>
      <Group title="Permissions & safety">
        <Pick
          k="permissions.defaultMode"
          label="When Claude wants to act"
          choices={modes}
          fallbackHint="What Claude may do without asking you first"
        />
        <Check
          k="sandbox.enabled"
          label="Sandbox shell commands"
          hint="Runs Claude's commands walled off from your files and network. macOS, Linux and WSL."
          defaultOn={false}
        />
        <Check
          k="permissions.disableBypassPermissionsMode"
          label="Block bypass-permissions mode"
          hint="No chat can switch to the mode that skips every check."
          defaultOn={false}
          onValue="disable"
        />
      </Group>
      <Group title="Git & attribution">
        <Attribution k="attribution.commit" label="Commit attribution" />
        <Attribution k="attribution.pr" label="Pull request attribution" />
        <Check
          k="includeGitInstructions"
          label="Built-in git guidance"
          hint="Claude's own instructions for writing commits and pull requests."
          defaultOn
        />
        <LegacyCoAuthor />
      </Group>
      <Group title="Context & chats">
        <Check
          k="autoCompactEnabled"
          label="Auto-compact"
          hint="Summarises older turns when the chat gets long, instead of stopping."
          defaultOn
        />
        <Check
          k="fileCheckpointingEnabled"
          label="File checkpoints"
          hint="Keeps a copy of every file Claude edits, so you can restore it."
          defaultOn
        />
        <Check
          k="autoMemoryEnabled"
          label="Auto memory"
          hint="Lets Claude save useful notes about your projects for next time."
          defaultOn
        />
        <Days
          k="cleanupPeriodDays"
          label="Keep chats for (days)"
          hint="Older chats and their checkpoints are deleted by Claude Code."
        />
      </Group>
      <Group title="Look & feel">
        <Pick k="outputStyle" label="Answer style" choices={STYLES} />
        <Pick
          k="editorMode"
          label="Typing keys"
          choices={[
            { value: "", label: "Normal" },
            { value: "vim", label: "Vim", hint: "Vim keys in Claude's prompt box" },
          ]}
        />
        <Check
          k="verbose"
          label="Show full tool output"
          hint="Shows everything a tool printed instead of a short summary."
          defaultOn={false}
        />
        <Check
          k="spinnerTipsEnabled"
          label="Tips while Claude works"
          hint="Short tips next to the spinner."
          defaultOn
        />
        <Check
          k="voice.enabled"
          label="Voice dictation"
          hint="Talk to Claude: hold the key to speak. Needs a Claude account."
          defaultOn={false}
        />
        <StatusLineRow />
      </Group>
      <ConfigActions />
      <p class="hero-note">
        Changes apply to new chats, are saved where they take effect, and can be undone.
      </p>
    </div>
  );
}

type PrefKey = keyof NonNullable<NonNullable<typeof store.env.value>["prefs"]>;

const setPref = (key: PrefKey, value: string | number | boolean) =>
  post({ type: "setPref", key, value } as ViewMsg);

function PrefPick({
  id,
  label,
  k,
  value,
  choices,
}: {
  id: string;
  label: string;
  k: PrefKey;
  value: string;
  choices: { value: string; label: string }[];
}) {
  return (
    <div class="q-row">
      <label class="q-label" for={id}>
        {label}
      </label>
      <select
        id={id}
        class="q-select"
        value={value}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          setPref(k, k === "restoreCount" ? Number(v) : v);
        }}
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** How Orbit itself opens chats and what the Chats tab starts with. */
function OrbitPrefs() {
  const p = store.env.value?.prefs;
  if (!p) return null;
  return (
    <Group title="Orbit">
      <PrefPick
        id="pref-open"
        label="Open chats in"
        k="openChatsIn"
        value={p.openChatsIn}
        choices={[
          { value: "terminal", label: "A terminal (Claude Code CLI)" },
          { value: "claudePanel", label: "Claude's VS Code chat panel" },
          { value: "auto", label: "Where each chat was started" },
          { value: "ask", label: "Ask each time" },
        ]}
      />
      {p.openChatsIn !== "claudePanel" ? (
        <>
          <PrefPick
            id="pref-where"
            label="Show the terminal"
            k="terminalLocation"
            value={p.terminalLocation}
            choices={[
              { value: "editor", label: "As an editor tab" },
              { value: "panel", label: "In the bottom panel" },
            ]}
          />
          {p.terminalLocation === "editor" ? (
            <PrefPick
              id="pref-column"
              label="Editor tab goes"
              k="editorPosition"
              value={p.editorPosition ?? "beside"}
              choices={[
                { value: "beside", label: "Beside the current editor" },
                { value: "active", label: "In the current editor group" },
                { value: "one", label: "In the first group" },
                { value: "two", label: "In the second group" },
                { value: "three", label: "In the third group" },
              ]}
            />
          ) : null}
          <div class="q-row">
            <label class="q-check">
              <input
                type="checkbox"
                checked={p.keepSessionNames === true}
                onChange={(e) =>
                  setPref("keepSessionNames", (e.target as HTMLInputElement).checked)
                }
              />
              Show chat names on terminal tabs
            </label>
            <p class="q-hint">
              Claude names each chat (like "✳ Fix cart"). Changes two VS Code terminal settings, put
              back when you turn this off.
            </p>
          </div>
        </>
      ) : null}
      <PrefPick
        id="pref-date"
        label="Chats starts with"
        k="defaultFilter"
        value={p.defaultFilter ?? "recent"}
        choices={[
          { value: "recent", label: "Pinned and the 20 most recent" },
          { value: "week", label: "The last 7 days" },
          { value: "month", label: "The last 30 days" },
          { value: "all", label: "Every chat" },
        ]}
      />
      <PrefPick
        id="pref-project"
        label="Chats from"
        k="defaultProject"
        value={p.defaultProject ?? "all"}
        choices={[
          { value: "all", label: "Every folder" },
          { value: "current", label: "This folder only" },
        ]}
      />
      <PrefPick
        id="pref-restore"
        label="Restore recent terminals opens"
        k="restoreCount"
        value={String(p.restoreCount ?? 4)}
        choices={Array.from({ length: 12 }, (_, i) => ({
          value: String(i + 1),
          label: `${i + 1} chat${i ? "s" : ""}`,
        }))}
      />
      <PrefPick
        id="density"
        label="Spacing"
        k="density"
        value={p.density ?? "comfortable"}
        choices={[
          { value: "comfortable", label: "Comfortable" },
          { value: "compact", label: "Compact (tighter rows)" },
        ]}
      />
    </Group>
  );
}

/** Which tabs Orbit shows, and in what order. Config always stays. */
function SidebarTabs() {
  const prefs = store.env.value?.prefs;
  const hidden = prefs?.hiddenTabs ?? [];
  const order = arrangeTabs(prefs?.tabOrder, []).map((t) => t.id);
  const move = (i: number, by: number) => {
    const next = [...order];
    const [t] = next.splice(i, 1);
    next.splice(i + by, 0, t!);
    post({ type: "setPref", key: "tabOrder", value: next } as ViewMsg);
  };
  const toggle = (id: Tab, show: boolean) =>
    post({
      type: "setPref",
      key: "hiddenTabs",
      value: show ? hidden.filter((x) => x !== id) : [...hidden, id],
    } as ViewMsg);
  return (
    <Group title="Sidebar tabs">
      <ul class="tab-prefs">
        {order.map((id, i) => {
          const t = tabDef(id);
          const always = id === ALWAYS_SHOWN;
          return (
            <li key={id} class="tab-pref">
              <label
                class="q-check"
                title={always ? "Config holds these settings, so it stays" : undefined}
              >
                <input
                  type="checkbox"
                  aria-label={`Show ${t.label}`}
                  checked={always || !hidden.includes(id)}
                  disabled={always}
                  onChange={(e) => toggle(id, (e.target as HTMLInputElement).checked)}
                />
                <span class="tab-pref-icon">
                  <Icon name={t.icon} />
                </span>{" "}
                {t.label}
              </label>
              <span class="tab-pref-moves">
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={`Move ${t.label} up`}
                  title="Move up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="arrow-up" />
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={`Move ${t.label} down`}
                  title="Move down"
                  disabled={i === order.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="arrow-down" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {prefs?.tabOrder?.length || hidden.length ? (
        <button
          type="button"
          class="btn small secondary"
          onClick={() => {
            post({ type: "setPref", key: "tabOrder", value: [] } as ViewMsg);
            post({ type: "setPref", key: "hiddenTabs", value: [] } as ViewMsg);
          }}
        >
          Back to Orbit's order
        </button>
      ) : null}
    </Group>
  );
}

const run = (id: "exportBrain" | "importBrain" | "runDiagnostics" | "reportProblem") =>
  post({ type: "orbitCommand", id });

/** Carry your setup to another computer, and get help when something's off. */
function BackupHelp() {
  return (
    <Group title="Backup & help">
      <p class="q-hint">
        A backup holds your CLAUDE.md, settings, skills, commands, agents and MCP servers. Keys and
        tokens are always left out.
      </p>
      <div class="q-actions">
        <button type="button" class="btn small secondary" onClick={() => run("exportBrain")}>
          Back up…
        </button>
        <button type="button" class="btn small secondary" onClick={() => run("importBrain")}>
          Bring in a backup…
        </button>
        <button type="button" class="btn small secondary" onClick={() => run("runDiagnostics")}>
          Check health
        </button>
        <button type="button" class="btn small secondary" onClick={() => run("reportProblem")}>
          Report a problem…
        </button>
      </div>
    </Group>
  );
}

/** Config: quick settings first, then the health check, permissions and every setting. */
export function ConfigView() {
  const s = store.setup.value;
  const q = store.setupQuery.value;
  const searching = q.trim() !== "";
  return (
    <section class="setup scroll config">
      <SetupToolbar placeholder="Search settings" />
      {!s ? (
        <Loading text="Reading your setup…" retry={{ type: "setup:refresh" }} />
      ) : (
        <>
          {searching ? null : <QuickSettings />}
          {!searching || matches(q, "orbit open chats terminal") ? <OrbitPrefs /> : null}
          {!searching || matches(q, "sidebar tabs order hide") ? <SidebarTabs /> : null}
          {!searching ||
          matches(q, "backup brain export import health diagnostics report problem") ? (
            <BackupHelp />
          ) : null}
          <h3 class="q-title config-more">More</h3>
          <HealthSection />
          <PermissionsSection />
          <SettingsSection />
          <HistorySection />
        </>
      )}
    </section>
  );
}
