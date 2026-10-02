import { useContext, useState } from "preact/hooks";
import type { SkillInfo } from "../../features/setup/skills";
import { itemFormError } from "../../shared/validate";
import { post } from "../bus";
import * as store from "../store";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import {
  Chips,
  CopyButton,
  DetailPage,
  FileText,
  Gone,
  Info,
  openDetail,
  Problems,
} from "./Detail";
import {
  Badge,
  decided,
  Empty,
  Field,
  FormError,
  LOCKED,
  matches,
  PageMode,
  Row,
  SCOPE_LABEL,
  Section,
  useSubmit,
} from "./parts";

export { AgentDetail, AgentsSection, modelFamily } from "./AgentsSection";
export { CommandDetail, CommandsSection } from "./CommandsSection";

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
  const { busy, submit } = useSubmit(onDone);
  const error = itemFormError({ name: slug, description });
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
      <FormError text={name || description ? error : null} />
      <div class="form-actions">
        <button
          type="button"
          class="btn"
          disabled={!!error || busy}
          onClick={() =>
            submit({ type: "setup:new", kind, scope, name: slug, description: description.trim() })
          }
        >
          {busy ? "Creating…" : "Create"}
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

type Visibility = "on" | "name-only" | "user-invocable-only" | "off";
const VISIBILITY: [Visibility, string][] = [
  ["on", "On"],
  ["name-only", "Name only"],
  ["user-invocable-only", "Only when you type it"],
  ["off", "Off"],
];

function visibilityOf(name: string): { value: Visibility; locked: boolean } {
  const d = decided("skillOverrides", name);
  const v = VISIBILITY.find(([k]) => k === d?.value)?.[0] ?? "on";
  return { value: v, locked: d?.scope === "managed" };
}

function SkillVisibility({ name }: { name: string }) {
  const { value, locked } = visibilityOf(name);
  return (
    <select
      class="mini-select"
      aria-label={`${name} visibility`}
      title={locked ? LOCKED : "What Claude sees of this skill"}
      value={value}
      disabled={locked}
      onChange={(e) =>
        post({
          type: "setup:skillVisibility",
          name,
          visibility: (e.target as HTMLSelectElement).value as Visibility,
        })
      }
    >
      {VISIBILITY.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

export type SkillScope = "all" | "project" | "user" | "plugin";

const SKILL_GROUP: Record<"project" | "user", string> = {
  project: "This project",
  user: "Yours (every project)",
};

/** Skills by where they come from: this project, yours, then one group per plugin. */
function skillGroups(list: SkillInfo[]): { title: string; items: SkillInfo[] }[] {
  const groups = new Map<string, SkillInfo[]>();
  for (const k of list) {
    const title = k.plugin ? `Plugin: ${k.plugin.split("@")[0]}` : SKILL_GROUP[k.scope as "user"];
    groups.set(title, [...(groups.get(title) ?? []), k]);
  }
  const rank = (t: string) => (t === SKILL_GROUP.project ? 0 : t === SKILL_GROUP.user ? 1 : 2);
  return [...groups]
    .map(([title, items]) => ({ title, items }))
    .sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title));
}

const inScope = (k: SkillInfo, scope: SkillScope) =>
  scope === "all" || (scope === "plugin" ? !!k.plugin : !k.plugin && k.scope === scope);

const WHERE: Record<string, string> = {
  project: "This project",
  user: "You (every project)",
};
const whereOf = (k: { scope: string; plugin: string | null }) =>
  k.plugin ? `Plugin ${k.plugin.split("@")[0]}` : (WHERE[k.scope] ?? k.scope);

function SkillBadges({ k }: { k: SkillInfo }) {
  return (
    <>
      <Badge>{k.plugin ? k.plugin.split("@")[0] : SCOPE_LABEL[k.scope]}</Badge>
      {!k.loaded ? (
        <Badge tone="warn" title="Claude Code doesn't load skills in a subfolder of a folder">
          Not loaded
        </Badge>
      ) : null}
      {k.linked ? (
        <Badge title="This skill's folder is a link to another place on disk">Linked</Badge>
      ) : null}
      {k.loaded && k.problems.length ? <Badge tone="warn">Check</Badge> : null}
    </>
  );
}

const canUse = (k: SkillInfo) => k.loaded && k.userInvocable;
const useWhy = (k: SkillInfo) =>
  !k.loaded
    ? "Claude Code doesn't load this skill where it is"
    : !k.userInvocable
      ? "This skill is only for Claude to use (user-invocable: false)"
      : `Start a new chat with ${k.command} typed in`;

/** One skill: how to use it, what it may do, and its SKILL.md. */
export function SkillDetail({ id }: { id: string }) {
  const k = store.setup.value?.skills.find((x) => x.file === id);
  if (!k) return <Gone back="All skills" what="skill" />;
  return (
    <DetailPage
      back="All skills"
      title={k.name}
      sub={k.description}
      badges={<SkillBadges k={k} />}
      actions={
        <>
          <button
            type="button"
            class="btn small"
            disabled={!canUse(k)}
            title={useWhy(k)}
            onClick={() => post({ type: "setup:launch", file: k.file })}
          >
            <Icon name="comment-discussion" /> Use in chat
          </button>
          <CopyButton text={k.command} label={`Copy ${k.command}`}>
            Copy {k.command}
          </CopyButton>
          <button
            type="button"
            class="btn small secondary"
            onClick={() => post({ type: "setup:open", file: k.file })}
          >
            <Icon name="go-to-file" /> Open file
          </button>
          {k.plugin || k.linked ? null : (
            <button
              type="button"
              class="btn small secondary danger"
              title="Moves the skill's folder to Orbit's trash; Undo puts it back"
              onClick={() => post({ type: "setup:trash", file: k.file })}
            >
              <Icon name="trash" /> Delete…
            </button>
          )}
        </>
      }
    >
      <Problems items={k.problems} />
      <Info
        label="About this skill"
        rows={[
          [
            "Type it as",
            <code key="c">{`${k.command}${k.argumentHint ? ` ${k.argumentHint}` : ""}`}</code>,
          ],
          ["From", whereOf(k)],
          ["In folder", k.group],
          ["Tags", k.tags.length ? <Chips items={k.tags} label="Tags" /> : null],
          ["Model", k.model],
          [
            "Tools it may use",
            k.allowedTools.length ? <Chips items={k.allowedTools} label="Tools" /> : null,
          ],
          [
            "Claude uses it on its own",
            k.modelInvocable ? "Yes, when it fits" : "No, only when you type it",
          ],
          ["You can type it", k.userInvocable ? "Yes" : "No"],
          // Claude's skillOverrides don't apply to plugin skills; /plugin manages those.
          ["What Claude sees", k.plugin ? null : <SkillVisibility key="v" name={k.name} />],
          [
            "File",
            <code key="f" class="srow-mono">
              {k.file}
            </code>,
          ],
        ]}
      />
      <FileText file={k.file} title="SKILL.md" />
    </DetailPage>
  );
}

export function SkillsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const page = useContext(PageMode);
  const scope = page ? store.skillScope.value : "all";
  const list = s.skills.filter(
    (k) => inScope(k, scope) && matches(q, k.name, k.description, k.plugin, k.tags.join(" ")),
  );
  const row = (k: SkillInfo) => (
    <Row
      key={k.file}
      title={k.name}
      sub={k.problems[0] ?? k.description}
      dim={!k.loaded}
      badges={<SkillBadges k={k} />}
      extra={k.tags.length ? <Chips items={k.tags} label={`${k.name} tags`} /> : null}
      onSelect={page ? () => openDetail("skills", k.file) : undefined}
      actions={
        <>
          {canUse(k) ? (
            <button
              type="button"
              class="icon-btn"
              title={useWhy(k)}
              aria-label={`Use ${k.command} in a new chat`}
              onClick={() => post({ type: "setup:launch", file: k.file })}
            >
              <Icon name="comment-discussion" />
            </button>
          ) : null}
          <CopyButton text={k.command} label={`Copy ${k.command}`} />
          {/* On its own page the picker is in the details; Config's list keeps it here. */}
          {k.plugin || page ? null : <SkillVisibility name={k.name} />}
        </>
      }
      onOpen={() => post({ type: "setup:open", file: k.file })}
    />
  );
  const count = (sc: SkillScope) => s.skills.filter((k) => inScope(k, sc)).length;
  return (
    <Section
      id="skills"
      title="Skills"
      icon="sparkle"
      count={page ? list.length : s.skills.length}
      hidden={q.trim() !== "" && list.length === 0}
    >
      {page && s.skills.length ? (
        <Segmented<SkillScope>
          legend="Show skills from"
          value={scope}
          onChange={(v) => (store.skillScope.value = v)}
          options={[
            { value: "all", label: "All", count: s.skills.length },
            ...(s.workspace
              ? [{ value: "project" as const, label: "Project", count: count("project") }]
              : []),
            { value: "user", label: "Yours", count: count("user") },
            ...(count("plugin")
              ? [{ value: "plugin" as const, label: "Plugins", count: count("plugin") }]
              : []),
          ]}
        />
      ) : null}
      {list.length ? (
        page ? (
          skillGroups(list).map((g) => (
            <div key={g.title} class="sgroup">
              <h3 class="sgroup-title">
                {g.title}
                <span class="sgroup-count">{g.items.length}</span>
              </h3>
              <ul class="srows">{g.items.map(row)}</ul>
            </div>
          ))
        ) : (
          <ul class="srows">{list.map(row)}</ul>
        )
      ) : (
        <Empty>
          {s.skills.length
            ? "No skills here. Try another filter."
            : "No skills yet. A skill teaches Claude a repeatable task, like writing release notes."}
        </Empty>
      )}
      <Adder kind="skill" />
    </Section>
  );
}
