import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { modelLabel } from "../../core/pricing";
import { MODE_LABELS } from "../../features/setup/risk";
import { post } from "../bus";
import * as store from "../store";
import { HealthSection } from "./HealthSection";
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
  const models: Choice[] = [
    { value: "", label: "Default", hint: "Claude Code picks the best model for your plan" },
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
      </Group>
      <p class="hero-note">
        Changes apply to new chats, are saved where they take effect, and can be undone.
      </p>
    </div>
  );
}

const PREF_CHOICES = {
  openChatsIn: [
    { value: "terminal", label: "A terminal (Claude Code CLI)" },
    { value: "claudePanel", label: "Claude's VS Code chat panel" },
  ],
  terminalLocation: [
    { value: "editor", label: "As an editor tab" },
    { value: "panel", label: "In the bottom panel" },
  ],
} as const;

/** How Orbit itself opens chats. */
function OrbitPrefs() {
  const prefs = store.env.value?.prefs;
  if (!prefs) return null;
  return (
    <Group title="Orbit">
      <div class="q-row">
        <label class="q-label" for="pref-open">
          Open chats in
        </label>
        <select
          id="pref-open"
          class="q-select"
          value={prefs.openChatsIn}
          onChange={(e) =>
            post({
              type: "setPref",
              key: "openChatsIn",
              value: (e.target as HTMLSelectElement).value as "terminal" | "claudePanel",
            })
          }
        >
          {PREF_CHOICES.openChatsIn.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {prefs.openChatsIn === "terminal" ? (
        <div class="q-row">
          <label class="q-label" for="pref-where">
            Show the terminal
          </label>
          <select
            id="pref-where"
            class="q-select"
            value={prefs.terminalLocation}
            onChange={(e) =>
              post({
                type: "setPref",
                key: "terminalLocation",
                value: (e.target as HTMLSelectElement).value as "editor" | "panel",
              })
            }
          >
            {PREF_CHOICES.terminalLocation.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
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
        <div class="loading" role="status">
          Reading your setup…
        </div>
      ) : (
        <>
          {searching ? null : <QuickSettings />}
          {!searching || matches(q, "orbit open chats terminal") ? <OrbitPrefs /> : null}
          <h3 class="q-title config-more">More</h3>
          <HealthSection />
          <PermissionsSection />
          <SettingsSection />
        </>
      )}
    </section>
  );
}
