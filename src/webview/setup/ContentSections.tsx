import { useState } from "preact/hooks";
import { post } from "../bus";
import * as store from "../store";
import { Badge, Empty, Field, matches, Row, SCOPE_LABEL, Section } from "./parts";

type Kind = "skill" | "agent" | "command";

function NewItem({ kind, onDone }: { kind: Kind; onDone: () => void }) {
  const hasWs = store.setup.value?.workspace != null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"user" | "project">("user");
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (
    <div class="form">
      <Field
        label="Name"
        value={name}
        onInput={setName}
        placeholder={kind === "agent" ? "code-reviewer" : "release-notes"}
      />
      <Field
        label="Description"
        value={description}
        onInput={setDescription}
        placeholder={
          kind === "skill"
            ? "Write release notes from merged pull requests"
            : "What it does and when to use it"
        }
      />
      {hasWs ? (
        <label class="field inline">
          <span>For</span>
          <select
            value={scope}
            onChange={(e) => setScope((e.target as HTMLSelectElement).value as "user" | "project")}
          >
            <option value="user">You (all projects)</option>
            <option value="project">This project (shared)</option>
          </select>
        </label>
      ) : null}
      <div class="form-actions">
        <button
          type="button"
          class="btn"
          disabled={!slug || !description.trim()}
          onClick={() => {
            post({ type: "setup:new", kind, scope, name: slug, description: description.trim() });
            onDone();
          }}
        >
          Create
        </button>
        <button type="button" class="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Adder({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <NewItem kind={kind} onDone={() => setOpen(false)} />
  ) : (
    <button type="button" class="btn secondary small" onClick={() => setOpen(true)}>
      New {kind}
    </button>
  );
}

function visibilityOf(name: string): "on" | "name-only" | "off" {
  const user = store.setup.value?.settings.find((f) => f.scope === "user")?.values.skillOverrides;
  const v = user && "entries" in user ? user.entries[name] : undefined;
  return v === "off" || v === "name-only" ? v : "on";
}

export function SkillsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const list = s.skills.filter((k) => matches(q, k.name, k.description, k.plugin));
  return (
    <Section
      id="skills"
      title="Skills"
      icon="book"
      count={s.skills.length}
      hidden={q.trim() !== "" && list.length === 0}
    >
      {list.length ? (
        <ul class="srows">
          {list.map((k) => (
            <Row
              key={k.file}
              title={k.name}
              sub={k.problems[0] ?? k.description}
              badges={
                <>
                  <Badge>{k.plugin ? k.plugin.split("@")[0] : SCOPE_LABEL[k.scope]}</Badge>
                  {k.problems.length ? <Badge tone="warn">Check</Badge> : null}
                </>
              }
              actions={
                <select
                  class="mini-select"
                  aria-label={`${k.name} visibility`}
                  title="What Claude sees of this skill"
                  value={visibilityOf(k.name)}
                  onChange={(e) =>
                    post({
                      type: "setup:skillVisibility",
                      name: k.name,
                      visibility: (e.target as HTMLSelectElement).value as
                        | "on"
                        | "name-only"
                        | "off",
                    })
                  }
                >
                  <option value="on">On</option>
                  <option value="name-only">Name only</option>
                  <option value="off">Off</option>
                </select>
              }
              onOpen={() => post({ type: "setup:open", file: k.file })}
            />
          ))}
        </ul>
      ) : (
        <Empty>
          No skills yet. A skill teaches Claude a repeatable task, like writing release notes.
        </Empty>
      )}
      <Adder kind="skill" />
    </Section>
  );
}

export function AgentsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const list = s.agents.filter((a) => matches(q, a.name, a.description, a.model, a.plugin));
  return (
    <Section
      id="agents"
      title="Agents"
      icon="hubot"
      count={s.agents.length}
      hidden={q.trim() !== "" && list.length === 0}
    >
      {list.length ? (
        <ul class="srows">
          {list.map((a) => (
            <Row
              key={a.file}
              title={a.name}
              sub={a.problems[0] ?? a.description}
              badges={
                <>
                  <Badge>{a.plugin ? a.plugin.split("@")[0] : SCOPE_LABEL[a.scope]}</Badge>
                  {a.model ? <Badge>{a.model}</Badge> : null}
                </>
              }
              onOpen={() => post({ type: "setup:open", file: a.file })}
            />
          ))}
        </ul>
      ) : (
        <Empty>
          No agents yet. An agent is a helper Claude can hand focused work to, like reviewing code.
        </Empty>
      )}
      <Adder kind="agent" />
    </Section>
  );
}

export function CommandsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const list = s.commands.filter((c) => matches(q, c.name, c.description, c.plugin));
  return (
    <Section
      id="commands"
      title="Commands"
      icon="terminal-cmd"
      count={s.commands.length}
      hidden={q.trim() !== "" && list.length === 0}
    >
      {list.length ? (
        <ul class="srows">
          {list.map((c) => (
            <Row
              key={c.file}
              title={`/${c.name}`}
              sub={c.problems[0] ?? c.description}
              badges={<Badge>{c.plugin ? c.plugin.split("@")[0] : SCOPE_LABEL[c.scope]}</Badge>}
              onOpen={() => post({ type: "setup:open", file: c.file })}
            />
          ))}
        </ul>
      ) : (
        <Empty>No custom commands. New ones are best written as skills.</Empty>
      )}
      <Adder kind="command" />
    </Section>
  );
}
