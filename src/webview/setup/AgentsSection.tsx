import { useContext, useEffect, useState } from "preact/hooks";
import type { AgentInfo } from "../../features/setup/agents";
import { post } from "../bus";
import * as store from "../store";
import { Icon } from "../ui/Icon";
import { Chips, DetailPage, Gone, Info, openDetail, Problems } from "./Detail";
import {
  Badge,
  Empty,
  Field,
  FormError,
  matches,
  PageMode,
  Row,
  SCOPE_LABEL,
  Section,
  useSubmit,
} from "./parts";

export type ModelFamily = "sonnet" | "opus" | "haiku" | "fable" | "inherit" | "custom";

/** Which of the model choices an agent's `model` is. */
export function modelFamily(model: string | null): ModelFamily {
  const m = (model ?? "inherit").toLowerCase();
  for (const f of ["inherit", "sonnet", "opus", "haiku", "fable"] as const)
    if (m === f || m.includes(f)) return f;
  return "custom";
}

const FAMILY_LABEL: Record<ModelFamily, string> = {
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
  fable: "Fable",
  inherit: "Same as the chat",
  custom: "Other model",
};

const WHERE: Record<string, string> = {
  project: "This project",
  user: "You (every project)",
};
const whereOf = (a: AgentInfo) =>
  a.plugin ? `Plugin ${a.plugin.split("@")[0]}` : (WHERE[a.scope] ?? a.scope);

function ModelBadge({ model }: { model: string | null }) {
  const f = modelFamily(model);
  return (
    <span class={`badge model-${f}`} title={model ?? "Uses the chat's model"}>
      {f === "custom" ? model : f === "inherit" ? "inherit" : FAMILY_LABEL[f]}
    </span>
  );
}

const MAX_TOOLS = 4;

function ToolBadges({ tools }: { tools: string[] }) {
  if (!tools.length) return null;
  const more = tools.length - MAX_TOOLS;
  return (
    <span class="tags inline">
      {tools.slice(0, MAX_TOOLS).map((t) => (
        <span key={t} class="tag">
          {t}
        </span>
      ))}
      {more > 0 ? (
        <span class="tag more" title={tools.slice(MAX_TOOLS).join(", ")}>
          +{more}
        </span>
      ) : null}
    </span>
  );
}

const groupTitle = (a: AgentInfo) =>
  a.plugin ? `Plugin: ${a.plugin.split("@")[0]}` : WHERE[a.scope]!;

export function AgentsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const page = useContext(PageMode);
  const [adding, setAdding] = useState(false);
  const family = page ? store.agentModel.value : "all";
  const list = s.agents.filter(
    (a) =>
      (family === "all" || modelFamily(a.model) === family) &&
      matches(q, a.name, a.description, a.model, a.plugin, a.tools.join(" ")),
  );
  const counts = new Map<ModelFamily, number>();
  for (const a of s.agents)
    counts.set(modelFamily(a.model), (counts.get(modelFamily(a.model)) ?? 0) + 1);
  const row = (a: AgentInfo) => (
    <Row
      key={a.file}
      title={a.name}
      sub={a.description ?? a.problems[0]}
      badges={
        <>
          {a.problems.length ? (
            <span class="warn-dot" role="img" aria-label={`Needs a look: ${a.problems[0]}`} />
          ) : null}
          <ModelBadge model={a.model} />
          <Badge>{a.plugin ? a.plugin.split("@")[0] : SCOPE_LABEL[a.scope]}</Badge>
        </>
      }
      extra={<ToolBadges tools={a.tools} />}
      onSelect={page ? () => openDetail("agents", a.file) : undefined}
      onOpen={() => post({ type: "setup:open", file: a.file })}
    />
  );
  const groups = new Map<string, AgentInfo[]>();
  for (const a of list) groups.set(groupTitle(a), [...(groups.get(groupTitle(a)) ?? []), a]);
  return (
    <Section
      id="agents"
      title="Agents"
      icon="hubot"
      count={page ? list.length : s.agents.length}
      hidden={q.trim() !== "" && list.length === 0}
    >
      {page && s.agents.length ? (
        <select
          class="page-filter"
          aria-label="Model"
          value={family}
          onChange={(e) =>
            (store.agentModel.value = (e.target as HTMLSelectElement).value as ModelFamily | "all")
          }
        >
          <option value="all">All models ({s.agents.length})</option>
          {(Object.keys(FAMILY_LABEL) as ModelFamily[])
            .filter((f) => counts.get(f))
            .map((f) => (
              <option key={f} value={f}>
                {FAMILY_LABEL[f]} ({counts.get(f)})
              </option>
            ))}
        </select>
      ) : null}
      {list.length ? (
        page ? (
          [...groups].map(([title, items]) => (
            <div key={title} class="sgroup">
              <h3 class="sgroup-title">
                {title}
                <span class="sgroup-count">{items.length}</span>
              </h3>
              <ul class="srows">{items.map(row)}</ul>
            </div>
          ))
        ) : (
          <ul class="srows">{list.map(row)}</ul>
        )
      ) : (
        <Empty>
          {s.agents.length
            ? "No agents here. Try another filter."
            : "No agents yet. An agent is a helper Claude can hand focused work to, like reviewing code."}
        </Empty>
      )}
      {adding ? (
        <AgentForm onDone={() => setAdding(false)} />
      ) : (
        <button type="button" class="btn secondary small" onClick={() => setAdding(true)}>
          New agent
        </button>
      )}
    </Section>
  );
}

/** The part of an agent file after its frontmatter: its system prompt. */
export function bodyOf(text: string): string {
  const m = text.replace(/^﻿/, "").match(/^---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m);
  return m && m.index === 0 ? text.replace(/^﻿/, "").slice(m[0].length) : text;
}

const list = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const FAMILIES: [string, string][] = [
  ["inherit", "Same as the chat"],
  ["sonnet", "Sonnet"],
  ["opus", "Opus"],
  ["haiku", "Haiku"],
  ["custom", "A specific model id…"],
];

function AgentForm({
  edit,
  prompt,
  onDone,
}: {
  edit?: AgentInfo;
  prompt?: string;
  onDone: () => void;
}) {
  const hasWs = store.setup.value?.workspace != null;
  const [name, setName] = useState(edit?.name ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [scope, setScope] = useState<"user" | "project">("user");
  const start = modelFamily(edit?.model ?? null);
  const [family, setFamily] = useState(start === "fable" || start === "custom" ? "custom" : start);
  const [custom, setCustom] = useState(
    start === "fable" || start === "custom" ? (edit?.model ?? "") : "",
  );
  const [tools, setTools] = useState(edit?.tools.join(", ") ?? "");
  const [skills, setSkills] = useState(edit?.skills.join(", ") ?? "");
  const [text, setText] = useState(prompt ?? "");
  const { busy, submit } = useSubmit(onDone);
  const slug = name.trim();
  const error = !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)
    ? "Use lowercase letters, numbers and dashes for the name (for example code-reviewer)."
    : !description.trim()
      ? "Add a short description: Claude uses it to decide when to hand work over."
      : family === "custom" && !/^[\w.[\]-]{1,100}$/.test(custom.trim())
        ? "Type the model id, for example claude-opus-5-5."
        : null;
  const touched = name !== (edit?.name ?? "") || description !== (edit?.description ?? "");
  const label = edit ? `Edit ${edit.name}` : "New agent";
  const send = () => {
    if (error) return;
    submit({
      type: "setup:agentSave",
      ...(edit ? { file: edit.file } : { scope }),
      name: slug,
      description: description.trim(),
      model: family === "inherit" ? null : family === "custom" ? custom.trim() : family,
      tools: list(tools),
      skills: list(skills),
      prompt: text,
    } as never);
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
      <Field label="Name" value={name} onInput={setName} placeholder="code-reviewer" />
      <Field
        label="Description"
        value={description}
        onInput={setDescription}
        placeholder="Reviews changes for bugs. Use after writing code."
      />
      {!edit && hasWs ? (
        <label class="field">
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
      <label class="field">
        <span>Model</span>
        <select value={family} onChange={(e) => setFamily((e.target as HTMLSelectElement).value)}>
          {FAMILIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {family === "custom" ? (
        <Field
          label="Model id"
          value={custom}
          onInput={setCustom}
          placeholder="claude-opus-5-5"
          mono
        />
      ) : null}
      <Field
        label="Tools (comma-separated; empty means every tool)"
        value={tools}
        onInput={setTools}
        placeholder="Read, Grep, Glob, Bash(git diff *)"
        mono
      />
      <Field
        label="Skills to load (comma-separated)"
        value={skills}
        onInput={setSkills}
        placeholder="release-notes"
        mono
      />
      <label class="field">
        <span>System prompt</span>
        <textarea
          rows={8}
          value={text}
          placeholder="You are a focused reviewer. Look for…"
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      <FormError text={touched || name ? error : null} />
      <div class="form-actions">
        <button type="submit" class="btn" disabled={!!error || busy}>
          {busy ? "Saving…" : edit ? "Save" : "Create"}
        </button>
        <button type="button" class="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** One agent: what it does, its tools, its prompt; edit, copy or delete it. */
export function AgentDetail({ id }: { id: string }) {
  const [editing, setEditing] = useState(false);
  const a = store.setup.value?.agents.find((x) => x.file === id);
  if (!a) return <Gone back="All agents" what="agent" />;
  const c = store.setupContent.value?.file === a.file ? store.setupContent.value : null;
  if (editing && c?.text != null)
    return (
      <DetailPage back="All agents" title={a.name}>
        <AgentForm edit={a} prompt={bodyOf(c.text)} onDone={() => setEditing(false)} />
      </DetailPage>
    );
  return (
    <DetailPage
      back="All agents"
      title={a.name}
      sub={a.description}
      badges={
        <>
          <ModelBadge model={a.model} />
          <Badge>{a.plugin ? a.plugin.split("@")[0] : SCOPE_LABEL[a.scope]}</Badge>
        </>
      }
      actions={
        <>
          {a.plugin ? null : (
            <button
              type="button"
              class="btn small"
              disabled={c?.text == null}
              title={c?.text == null ? "Reading the file…" : "Change any of its fields"}
              onClick={() => setEditing(true)}
            >
              <Icon name="edit" /> Edit
            </button>
          )}
          <button
            type="button"
            class="btn small secondary"
            onClick={() => post({ type: "setup:open", file: a.file })}
          >
            <Icon name="go-to-file" /> Open file
          </button>
          {a.plugin ? null : (
            <button
              type="button"
              class="btn small secondary"
              onClick={() => post({ type: "setup:agentDuplicate", file: a.file })}
            >
              <Icon name="copy" /> Duplicate
            </button>
          )}
          {a.plugin ? null : (
            <button
              type="button"
              class="btn small secondary danger"
              title="Moves the file to Orbit's trash; Undo puts it back"
              onClick={() => post({ type: "setup:trash", file: a.file })}
            >
              <Icon name="trash" /> Delete…
            </button>
          )}
        </>
      }
    >
      <Problems items={a.problems} />
      <Info
        label="About this agent"
        rows={[
          ["Model", a.model ?? "Same as the chat"],
          ["Tools", a.tools.length ? <Chips items={a.tools} label="Tools" /> : "Every tool"],
          ["Skills it loads", a.skills.length ? <Chips items={a.skills} label="Skills" /> : null],
          ["From", whereOf(a)],
          [
            "File",
            <code key="f" class="srow-mono">
              {a.file}
            </code>,
          ],
        ]}
      />
      <section class="detail-block" aria-label="System prompt">
        <h4 class="subgroup-title">System prompt</h4>
        {c === null ? (
          <p class="muted" role="status">
            Reading…
          </p>
        ) : c.text === null ? (
          <p class="muted">This file is too large to show here. Open it to see it.</p>
        ) : (
          <pre class="file-text">{bodyOf(c.text).trim() || "(empty)"}</pre>
        )}
      </section>
      <ReadFile file={a.file} />
    </DetailPage>
  );
}

/** Asks the host for the file when the page opens. */
function ReadFile({ file }: { file: string }) {
  useEffect(() => {
    post({ type: "setup:read", file });
  }, [file]);
  return null;
}
