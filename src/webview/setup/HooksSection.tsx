import { useContext, useState } from "preact/hooks";
import { HOOK_EVENTS, HOOK_INFO, hookTitle, TOOL_EVENTS } from "../../features/setup/hookEvents";
import type { HookEntry } from "../../features/setup/hooks";
import type { PausedHookView } from "../../features/setup/pausedHooks";
import { hookFormError } from "../../shared/validate";
import { post } from "../bus";
import * as store from "../store";
import { Icon, IconButton } from "../ui/Icon";
import { CopyButton, DetailPage, Gone, Info, openDetail } from "./Detail";
import {
  Badge,
  decided,
  type EditScope,
  Empty,
  Field,
  FormError,
  matches,
  PageMode,
  Row,
  SCOPE_LABEL,
  ScopeSelect,
  Section,
  Switch,
  useSubmit,
} from "./parts";

const eventTitle = (e: string) => HOOK_INFO[e]?.title ?? e;
const editable = (h: HookEntry) =>
  !h.plugin && h.scope !== "managed" && h.scope !== "plugin" && h.type === "command";

function HookForm({ edit, onDone }: { edit?: HookEntry; onDone: () => void }) {
  const [event, setEvent] = useState<string>(edit?.event ?? "Stop");
  const [matcher, setMatcher] = useState(edit?.matcher ?? "");
  const [command, setCommand] = useState(edit?.command ?? "");
  const [timeout, setTimeoutText] = useState(edit?.timeout ? String(edit.timeout) : "");
  const [scope, setScope] = useState<EditScope>(
    edit && edit.scope !== "managed" && edit.scope !== "plugin" ? edit.scope : "user",
  );
  const { busy, submit } = useSubmit(onDone);
  const seconds = timeout.trim() ? Number(timeout) : null;
  const error =
    hookFormError({ command, matcher }) ??
    (seconds !== null && (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
      ? "The time limit is a whole number of seconds, up to 3600."
      : null);
  const tool = TOOL_EVENTS.has(event);
  const label = edit ? "Edit hook" : "Add a hook";
  const send = () => {
    if (error) return;
    // Every event may have a matcher (SessionStart "compact", PreCompact "auto"…): never drop one.
    const m = matcher.trim() ? matcher.trim() : null;
    submit(
      (edit
        ? {
            type: "setup:hookEdit",
            id: edit.id,
            scope,
            event,
            matcher: m,
            command: command.trim(),
            timeout: seconds,
          }
        : {
            type: "setup:hookAdd",
            scope,
            event,
            matcher: m,
            command: command.trim(),
            ...(seconds ? { timeout: seconds } : {}),
          }) as never,
    );
  };
  return (
    <form
      class="form"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <h4 class="form-title">{label}</h4>
      <label class="field">
        <span>When</span>
        <select value={event} onChange={(e) => setEvent((e.target as HTMLSelectElement).value)}>
          {HOOK_EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {eventTitle(ev)} ({ev})
            </option>
          ))}
        </select>
      </label>
      <p class="form-hint">{HOOK_INFO[event]?.when}</p>
      {tool ? (
        <Field
          label="For tools"
          value={matcher}
          onInput={setMatcher}
          placeholder="Bash, Edit|Write, or empty for all"
        />
      ) : (
        <Field
          label="Only when (optional matcher)"
          value={matcher}
          onInput={setMatcher}
          placeholder="Empty for always, for example compact or auto"
        />
      )}
      <Field label="Run" value={command} onInput={setCommand} placeholder="~/bin/notify.sh" mono />
      <Field
        label="Time limit in seconds (optional)"
        value={timeout}
        onInput={setTimeoutText}
        placeholder="60"
      />
      <ScopeSelect value={scope} onChange={setScope} label="Saved in" />
      <p class="form-hint">
        A hook runs this command on your computer with your permissions. Only add ones you trust.
      </p>
      <FormError text={command || matcher || timeout ? error : null} />
      <div class="form-actions">
        <button type="submit" class="btn" disabled={!!error || busy}>
          {busy ? "Saving…" : edit ? "Save" : "Add hook"}
        </button>
        <button type="button" class="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MatcherPill({ m }: { m: string | null }) {
  return m ? (
    <span class="pill mono" title="Only for these tools">
      {m}
    </span>
  ) : null;
}

export function HooksSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const page = useContext(PageMode);
  const [adding, setAdding] = useState(false);
  const hay = (h: {
    event: string;
    matcher: string | null;
    command: string | null;
    url: string | null;
  }) => [h.event, eventTitle(h.event), h.matcher, h.command, h.url];
  const list = s.hooks.filter((h) => matches(q, ...hay(h), h.plugin));
  const paused = s.pausedHooks.filter((h) => matches(q, ...hay(h)));
  const pausedBy = decided("disableAllHooks");
  const allPaused = pausedBy?.value === true;
  const events = HOOK_EVENTS.filter(
    (ev) => list.some((h) => h.event === ev) || paused.some((h) => h.event === ev),
  ) as string[];
  for (const h of list) if (!events.includes(h.event)) events.push(h.event);
  const row = (h: HookEntry) => {
    const title = hookTitle(h.command, h.url);
    return (
      <Row
        key={h.id}
        title={title}
        mono={h.command ?? h.url ?? h.type}
        badges={
          <>
            <MatcherPill m={h.matcher} />
            <Badge>{h.plugin ? h.plugin.split("@")[0] : SCOPE_LABEL[h.scope]}</Badge>
          </>
        }
        onSelect={page ? () => openDetail("hooks", h.id) : undefined}
        actions={
          editable(h) ? (
            <>
              <IconButton
                icon="debug-pause"
                label={`Pause ${title}`}
                onClick={() => post({ type: "setup:hookPause", id: h.id })}
              />
              <IconButton
                icon="trash"
                label="Remove hook"
                onClick={() => post({ type: "setup:hookRemove", id: h.id })}
              />
            </>
          ) : null
        }
        onOpen={h.plugin ? undefined : () => post({ type: "setup:open", file: h.source })}
      />
    );
  };
  const pausedRow = (h: PausedHookView) => {
    const title = hookTitle(h.command, h.url);
    return (
      <Row
        key={h.id}
        title={title}
        mono={h.command ?? h.url ?? h.type}
        dim
        badges={
          <>
            <MatcherPill m={h.matcher} />
            <Badge tone="warn" title="Orbit took it out of the file; Resume puts it back">
              Paused
            </Badge>
            <Badge>{SCOPE_LABEL[h.scope]}</Badge>
          </>
        }
        actions={
          <IconButton
            icon="debug-start"
            label={`Resume ${title}`}
            onClick={() => post({ type: "setup:hookResume", id: h.id })}
          />
        }
      />
    );
  };
  return (
    <Section
      id="hooks"
      title="Hooks"
      icon="zap"
      count={s.hooks.length}
      note={allPaused ? "All paused" : paused.length ? `${paused.length} paused` : undefined}
      hidden={q.trim() !== "" && list.length === 0 && paused.length === 0}
    >
      <div class="sec-toolbar">
        <span>Pause all hooks</span>
        <Switch
          on={allPaused}
          disabled={pausedBy?.scope === "managed"}
          label="Pause all hooks"
          onChange={(p) => post({ type: "setup:hooksPaused", paused: p })}
        />
      </div>
      {events.length ? (
        events.map((ev) => (
          <div key={ev} class="subgroup">
            <h4 class="subgroup-title" title={HOOK_INFO[ev]?.when}>
              {eventTitle(ev)} <span class="muted">· {ev}</span>
            </h4>
            <ul class="srows">
              {list.filter((h) => h.event === ev).map(row)}
              {paused.filter((h) => h.event === ev).map(pausedRow)}
            </ul>
          </div>
        ))
      ) : (
        <Empty>
          No hooks. A hook runs your own command at moments like "Claude finished" or "before a tool
          runs".
        </Empty>
      )}
      {adding ? (
        <HookForm onDone={() => setAdding(false)} />
      ) : (
        <button type="button" class="btn secondary small" onClick={() => setAdding(true)}>
          Add hook
        </button>
      )}
    </Section>
  );
}

/** One hook: what runs, when, and every way to change it. */
export function HookDetail({ id }: { id: string }) {
  const [editing, setEditing] = useState(false);
  const h = store.setup.value?.hooks.find((x) => x.id === id);
  if (!h) return <Gone back="All hooks" what="hook" />;
  const title = hookTitle(h.command, h.url);
  if (editing)
    return (
      <DetailPage back="All hooks" title={title}>
        <HookForm edit={h} onDone={() => setEditing(false)} />
      </DetailPage>
    );
  const own = editable(h);
  return (
    <DetailPage
      back="All hooks"
      title={title}
      sub={HOOK_INFO[h.event]?.when}
      badges={
        <>
          <MatcherPill m={h.matcher} />
          <Badge>{h.plugin ? h.plugin.split("@")[0] : SCOPE_LABEL[h.scope]}</Badge>
        </>
      }
      actions={
        <>
          {own ? (
            <button type="button" class="btn small" onClick={() => setEditing(true)}>
              <Icon name="edit" /> Edit
            </button>
          ) : null}
          {h.command ? (
            <CopyButton text={h.command} label="Copy command">
              Copy command
            </CopyButton>
          ) : null}
          {own ? (
            <button
              type="button"
              class="btn small secondary"
              onClick={() => post({ type: "setup:hookPause", id: h.id })}
            >
              <Icon name="debug-pause" /> Pause
            </button>
          ) : null}
          {h.plugin ? null : (
            <button
              type="button"
              class="btn small secondary"
              onClick={() => post({ type: "setup:open", file: h.source })}
            >
              <Icon name="go-to-file" /> Open settings file
            </button>
          )}
          <button
            type="button"
            class="btn small secondary"
            title="Claude Code's own hooks screen, in a terminal"
            onClick={() => post({ type: "setup:run", what: "slashHooks" })}
          >
            <Icon name="terminal" /> Open /hooks
          </button>
          {own ? (
            <button
              type="button"
              class="btn small secondary danger"
              onClick={() => post({ type: "setup:hookRemove", id: h.id })}
            >
              <Icon name="trash" /> Remove…
            </button>
          ) : null}
        </>
      }
    >
      <Info
        label="About this hook"
        rows={[
          ["When", `${eventTitle(h.event)} (${h.event})`],
          ["Runs", HOOK_INFO[h.event]?.when],
          [
            "For tools",
            h.matcher ? (
              <span class="pill mono">{h.matcher}</span>
            ) : TOOL_EVENTS.has(h.event) ? (
              "Every tool"
            ) : null,
          ],
          ["Type", h.type],
          ["Command", h.command ? <code class="srow-mono wrap">{h.command}</code> : null],
          ["Address", h.url],
          ["Time limit", h.timeout ? `${h.timeout} seconds` : "Claude's default"],
          ["Saved in", h.plugin ? `Plugin ${h.plugin.split("@")[0]}` : SCOPE_LABEL[h.scope]],
          [
            "File",
            <code key="f" class="srow-mono">
              {h.source}
            </code>,
          ],
        ]}
      />
    </DetailPage>
  );
}
