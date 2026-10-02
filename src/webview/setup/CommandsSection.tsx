import { useContext } from "preact/hooks";
import { BUILTIN_COMMANDS, type BuiltinCommand } from "../../features/setup/builtinCommands";
import type { CommandInfo } from "../../features/setup/commands";
import { post } from "../bus";
import * as store from "../store";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { CopyButton, DetailPage, FileText, Gone, Info, openDetail, Problems } from "./Detail";
import { Badge, Empty, matches, PageMode, Row, SCOPE_LABEL, Section } from "./parts";

export type CommandScope = "all" | "builtin" | "project" | "user" | "plugin";

const BUILTIN_KEY = "builtin:";
const PREVIEW = 80;
const short = (s: string | null) =>
  s && s.length > PREVIEW ? `${s.slice(0, PREVIEW - 1).trimEnd()}…` : s;

const WHERE: Record<string, string> = {
  project: "This project",
  user: "You (every project)",
};
const whereOf = (c: CommandInfo) =>
  c.plugin ? `Plugin ${c.plugin.split("@")[0]}` : (WHERE[c.scope] ?? c.scope);
const groupOf = (c: CommandInfo) =>
  c.plugin ? `Plugin: ${c.plugin.split("@")[0]}` : WHERE[c.scope]!;

const inScope = (c: CommandInfo, scope: CommandScope) =>
  scope === "all" || (scope === "plugin" ? !!c.plugin : !c.plugin && c.scope === scope);

function UseButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="icon-btn"
      title={`Start a new chat with /${name} typed in`}
      aria-label={`Use /${name} in a new chat`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name="comment-discussion" />
    </button>
  );
}

export function CommandsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const page = useContext(PageMode);
  const scope = page ? store.commandScope.value : "all";
  const custom = s.commands.filter(
    (c) => inScope(c, scope) && matches(q, c.name, c.description, c.plugin),
  );
  // Built-ins only on the Commands tab itself; Config lists just yours.
  const builtins =
    page && (scope === "all" || scope === "builtin")
      ? BUILTIN_COMMANDS.filter((b) => matches(q, b.name, b.description, b.aliases.join(" ")))
      : [];
  const ownRow = (c: CommandInfo) => (
    <Row
      key={c.file}
      title={`/${c.name}`}
      sub={short(c.problems[0] ?? c.description)}
      badges={<Badge>{c.plugin ? c.plugin.split("@")[0] : SCOPE_LABEL[c.scope]}</Badge>}
      onSelect={page ? () => openDetail("commands", c.file) : undefined}
      actions={
        <>
          <UseButton name={c.name} onClick={() => post({ type: "setup:launch", file: c.file })} />
          <CopyButton text={`/${c.name}`} label={`Copy /${c.name}`} />
        </>
      }
      onOpen={() => post({ type: "setup:open", file: c.file })}
    />
  );
  const builtinRow = (b: BuiltinCommand) => (
    <Row
      key={b.name}
      title={`/${b.name}`}
      sub={short(b.description)}
      badges={
        b.kind === "skill" ? <Badge title="A skill that comes with Claude Code">skill</Badge> : null
      }
      onSelect={() => openDetail("commands", BUILTIN_KEY + b.name)}
      actions={
        <>
          <UseButton
            name={b.name}
            onClick={() => post({ type: "setup:launchBuiltin", name: b.name })}
          />
          <CopyButton text={`/${b.name}`} label={`Copy /${b.name}`} />
        </>
      }
    />
  );
  const groups = new Map<string, CommandInfo[]>();
  for (const c of custom) groups.set(groupOf(c), [...(groups.get(groupOf(c)) ?? []), c]);
  const count = (sc: CommandScope) =>
    sc === "builtin" ? BUILTIN_COMMANDS.length : s.commands.filter((c) => inScope(c, sc)).length;
  const total = custom.length + builtins.length;
  return (
    <Section
      id="commands"
      title="Commands"
      icon="terminal-cmd"
      count={page ? total : s.commands.length}
      hidden={q.trim() !== "" && total === 0}
    >
      {page ? (
        <Segmented<CommandScope>
          legend="Show commands"
          value={scope}
          onChange={(v) => (store.commandScope.value = v)}
          options={[
            { value: "all", label: "All", count: BUILTIN_COMMANDS.length + s.commands.length },
            { value: "builtin", label: "Built-in", count: BUILTIN_COMMANDS.length },
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
      {total === 0 ? (
        <Empty>
          {page
            ? "No commands here. Try another filter."
            : "No custom commands. New ones are best written as skills."}
        </Empty>
      ) : page ? (
        <>
          {[...groups].map(([title, items]) => (
            <div key={title} class="sgroup">
              <h3 class="sgroup-title">
                {title}
                <span class="sgroup-count">{items.length}</span>
              </h3>
              <ul class="srows">{items.map(ownRow)}</ul>
            </div>
          ))}
          {builtins.length ? (
            <div class="sgroup">
              <h3 class="sgroup-title">
                Built into Claude Code
                <span class="sgroup-count">{builtins.length}</span>
              </h3>
              <ul class="srows">{builtins.map(builtinRow)}</ul>
            </div>
          ) : null}
        </>
      ) : (
        <ul class="srows">{custom.map(ownRow)}</ul>
      )}
    </Section>
  );
}

/** One command: built-in (with Claude's docs) or yours (with its file). */
export function CommandDetail({ id }: { id: string }) {
  if (id.startsWith(BUILTIN_KEY)) {
    const b = BUILTIN_COMMANDS.find((x) => x.name === id.slice(BUILTIN_KEY.length));
    if (!b) return <Gone back="All commands" what="command" />;
    return (
      <DetailPage
        back="All commands"
        title={`/${b.name}`}
        sub={b.description}
        badges={<Badge>{b.kind === "skill" ? "Built-in skill" : "Built-in"}</Badge>}
        actions={
          <>
            <button
              type="button"
              class="btn small"
              onClick={() => post({ type: "setup:launchBuiltin", name: b.name })}
            >
              <Icon name="comment-discussion" /> Use in chat
            </button>
            <CopyButton text={`/${b.name}`} label={`Copy /${b.name}`}>
              Copy /{b.name}
            </CopyButton>
            <button
              type="button"
              class="btn small secondary"
              onClick={() => post({ type: "openOrbitLink", link: "commandsDocs" })}
            >
              <Icon name="link-external" /> Read the docs
            </button>
          </>
        }
      >
        <Info
          label="About this command"
          rows={[
            ["Type it as", <code key="c">/{b.name}</code>],
            ["Also works as", b.aliases.length ? b.aliases.map((a) => `/${a}`).join(", ") : null],
            ["From", "Built into Claude Code"],
          ]}
        />
      </DetailPage>
    );
  }
  const c = store.setup.value?.commands.find((x) => x.file === id);
  if (!c) return <Gone back="All commands" what="command" />;
  return (
    <DetailPage
      back="All commands"
      title={`/${c.name}`}
      sub={c.description}
      badges={<Badge>{c.plugin ? c.plugin.split("@")[0] : SCOPE_LABEL[c.scope]}</Badge>}
      actions={
        <>
          <button
            type="button"
            class="btn small"
            onClick={() => post({ type: "setup:launch", file: c.file })}
          >
            <Icon name="comment-discussion" /> Use in chat
          </button>
          <CopyButton text={`/${c.name}`} label={`Copy /${c.name}`}>
            Copy /{c.name}
          </CopyButton>
          <button
            type="button"
            class="btn small secondary"
            onClick={() => post({ type: "setup:open", file: c.file })}
          >
            <Icon name="go-to-file" /> Open file
          </button>
          {c.plugin ? null : (
            <button
              type="button"
              class="btn small secondary danger"
              title="Moves the file to Orbit's trash; Undo puts it back"
              onClick={() => post({ type: "setup:trash", file: c.file })}
            >
              <Icon name="trash" /> Delete…
            </button>
          )}
        </>
      }
    >
      <Problems items={c.problems} />
      <Info
        label="About this command"
        rows={[
          [
            "Type it as",
            <code key="c">{`/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ""}`}</code>,
          ],
          ["From", whereOf(c)],
          [
            "File",
            <code key="f" class="srow-mono">
              {c.file}
            </code>,
          ],
        ]}
      />
      <FileText file={c.file} title="What it tells Claude" />
    </DetailPage>
  );
}
