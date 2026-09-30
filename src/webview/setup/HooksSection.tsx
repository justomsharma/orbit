import { useState } from "preact/hooks";
import { HOOK_EVENTS, TOOL_EVENTS } from "../../features/setup/hookEvents";
import { hookFormError } from "../../shared/validate";
import { post } from "../bus";
import * as store from "../store";
import { IconButton } from "../ui/Icon";
import {
  Badge,
  decided,
  type EditScope,
  Empty,
  Field,
  FormError,
  matches,
  Row,
  SCOPE_LABEL,
  ScopeSelect,
  Section,
  Switch,
  useSubmit,
} from "./parts";

function AddHook({ onDone }: { onDone: () => void }) {
  const [event, setEvent] = useState<string>("Stop");
  const [matcher, setMatcher] = useState("");
  const [command, setCommand] = useState("");
  const [scope, setScope] = useState<EditScope>("user");
  const { busy, submit } = useSubmit(onDone);
  const error = hookFormError({ command, matcher });
  return (
    <div class="form">
      <label class="field">
        <span>When</span>
        <select value={event} onChange={(e) => setEvent((e.target as HTMLSelectElement).value)}>
          {HOOK_EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
      </label>
      {TOOL_EVENTS.has(event) ? (
        <Field
          label="For tools"
          value={matcher}
          onInput={setMatcher}
          placeholder="Bash, Edit|Write, or empty for all"
        />
      ) : null}
      <Field label="Run" value={command} onInput={setCommand} placeholder="~/bin/notify.sh" mono />
      <ScopeSelect value={scope} onChange={setScope} />
      <FormError text={command || matcher ? error : null} />
      <div class="form-actions">
        <button
          type="button"
          class="btn"
          disabled={!!error || busy}
          onClick={() =>
            submit({
              type: "setup:hookAdd",
              scope,
              event,
              matcher: TOOL_EVENTS.has(event) && matcher.trim() ? matcher.trim() : null,
              command: command.trim(),
            })
          }
        >
          {busy ? "Adding…" : "Add hook"}
        </button>
        <button type="button" class="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function HooksSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const [adding, setAdding] = useState(false);
  const list = s.hooks.filter((h) => matches(q, h.event, h.matcher, h.command, h.url, h.plugin));
  const pausedBy = decided("disableAllHooks");
  const paused = pausedBy?.value === true;
  const events = [...new Set(list.map((h) => h.event))];
  return (
    <Section
      id="hooks"
      title="Hooks"
      icon="zap"
      count={s.hooks.length}
      note={paused ? "Paused" : undefined}
      hidden={q.trim() !== "" && list.length === 0}
    >
      <div class="sec-toolbar">
        <span>Pause all hooks</span>
        <Switch
          on={paused}
          disabled={pausedBy?.scope === "managed"}
          label="Pause all hooks"
          onChange={(p) => post({ type: "setup:hooksPaused", paused: p })}
        />
      </div>
      {events.length ? (
        events.map((ev) => (
          <div key={ev} class="subgroup">
            <h4 class="subgroup-title">{ev}</h4>
            <ul class="srows">
              {list
                .filter((h) => h.event === ev)
                .map((h) => (
                  <Row
                    key={h.id}
                    title={h.matcher ? `On ${h.matcher}` : "Always"}
                    mono={h.command ?? h.url ?? h.type}
                    badges={
                      <Badge>{h.plugin ? h.plugin.split("@")[0] : SCOPE_LABEL[h.scope]}</Badge>
                    }
                    actions={
                      h.plugin || h.scope === "managed" ? null : (
                        <IconButton
                          icon="trash"
                          label="Remove hook"
                          onClick={() => post({ type: "setup:hookRemove", id: h.id })}
                        />
                      )
                    }
                    onOpen={
                      h.plugin ? undefined : () => post({ type: "setup:open", file: h.source })
                    }
                  />
                ))}
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
        <AddHook onDone={() => setAdding(false)} />
      ) : (
        <button type="button" class="btn secondary small" onClick={() => setAdding(true)}>
          Add hook
        </button>
      )}
    </Section>
  );
}
