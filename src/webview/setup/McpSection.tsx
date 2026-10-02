import { useContext, useState } from "preact/hooks";
import type { McpServer } from "../../features/setup/mcp";
import { mcpFormError, splitCommand } from "../../shared/validate";
import { post } from "../bus";
import * as store from "../store";
import { Icon, IconButton } from "../ui/Icon";
import { type MenuItem, showMenu } from "../ui/Menu";
import { Segmented } from "../ui/Segmented";
import { CopyButton, DetailPage, Gone, Info, openDetail } from "./Detail";
import {
  Badge,
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

type McpScopeFilter = "all" | "project" | "local" | "user" | "plugin";

const TRANSPORT_TITLE: Record<string, string> = {
  stdio: "Runs as a command on this computer",
  http: "A remote server over HTTP",
  sse: "A remote server over SSE (older; Claude Code prefers HTTP)",
  ws: "A server over a web socket (ws)",
};

/** KEY=value lines → an object, or the line numbers that aren't. */
export function parsePairs(
  text: string,
  key: RegExp,
): { pairs: Record<string, string>; bad: number[] } {
  const pairs: Record<string, string> = {};
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const at = line.indexOf("=");
    const k = at > 0 ? line.slice(0, at).trim() : "";
    if (!k || !key.test(k)) bad.push(i + 1);
    else pairs[k] = line.slice(at + 1).trim();
  });
  return { pairs, bad };
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,100}$/;
const HEADER_KEY = /^[A-Za-z0-9-]{1,100}$/;

function mcpMenu(m: McpServer, edit: () => void): MenuItem[] {
  const editable = m.scope !== "plugin";
  const remote = m.transport !== "stdio";
  const items: MenuItem[] = [];
  if (editable) items.push({ label: "Edit…", icon: "edit", run: edit });
  if (m.scope === "project" && m.approval !== "approved")
    items.push({
      label: "Approve (use it)",
      icon: "check",
      run: () => post({ type: "setup:mcpApproval", name: m.name, state: "approved" }),
    });
  if (m.scope === "project" && m.approval === "approved")
    items.push({
      label: "Stop using it in this folder",
      icon: "circle-slash",
      run: () => post({ type: "setup:mcpApproval", name: m.name, state: "rejected" }),
    });
  if (remote && editable)
    items.push(
      { kind: "separator" },
      { label: "Sign in", icon: "key", run: () => post({ type: "setup:mcpLogin", name: m.name }) },
      {
        label: "Clear sign-in",
        icon: "sign-out",
        run: () => post({ type: "setup:run", what: "mcpLogout", name: m.name }),
      },
    );
  items.push(
    { kind: "separator" },
    {
      label: "Check its status",
      icon: "pulse",
      run: () => post({ type: "setup:run", what: "mcpGet", name: m.name }),
    },
    {
      label: "Reconnect servers (/mcp)",
      icon: "debug-restart",
      run: () => post({ type: "setup:run", what: "slashMcp" }),
    },
    {
      label: "Copy name",
      icon: "copy",
      run: () => void navigator.clipboard?.writeText(m.name).catch(() => {}),
    },
  );
  if (editable)
    items.push(
      {
        label: "Open config file",
        icon: "go-to-file",
        run: () => post({ type: "setup:open", file: m.source }),
      },
      { kind: "separator" },
      {
        label: "Remove",
        icon: "trash",
        danger: true,
        run: () => post({ type: "setup:mcpRemove", scope: m.scope as EditScope, name: m.name }),
      },
    );
  return items;
}

export const mcpKey = (m: McpServer) => `${m.scope}:${m.plugin ?? ""}:${m.name}`;

function McpRow({ m, onEdit }: { m: McpServer; onEdit: () => void }) {
  const s = store.setup.value!;
  const page = useContext(PageMode);
  const where = m.command ? [m.command, ...m.args].join(" ") : (m.url ?? "");
  const missing = m.transport === "stdio" && !!m.command && s.missingCommands.includes(m.command);
  const off = m.scope === "project" && m.approval === "rejected";
  const needsAuth = s.mcpNeedsAuth.includes(m.name);
  return (
    <Row
      title={m.name}
      onSelect={page ? () => openDetail("mcp", mcpKey(m)) : undefined}
      sub={
        m.problem ??
        (m.plugin
          ? `From plugin ${m.plugin}`
          : m.envKeys.length
            ? `Uses ${m.envKeys.join(", ")}`
            : null)
      }
      mono={where}
      badges={
        <>
          {m.transport === "stdio" && m.command ? (
            <span
              class={`health-dot${missing ? " bad" : " ok"}`}
              role="img"
              aria-label={missing ? `"${m.command}" wasn't found` : "Its command is installed"}
              title={
                missing
                  ? `Launch command "${m.command}" isn't on PATH`
                  : "Launch command found (not a live connection check)"
              }
            />
          ) : null}
          <Badge>{SCOPE_LABEL[m.scope]}</Badge>
          <span class={`badge transport ${m.transport}`} title={TRANSPORT_TITLE[m.transport]}>
            {m.transport}
          </span>
          {m.plugin ? <Badge title={`Owned by plugin ${m.plugin}`}>read-only</Badge> : null}
          {m.approval === "pending" ? <Badge tone="warn">Waiting for approval</Badge> : null}
          {needsAuth ? <Badge tone="warn">Needs sign-in</Badge> : null}
        </>
      }
      actions={
        <>
          {m.scope === "project" && m.approval !== "pending" ? (
            <Switch
              on={!off}
              label={`${m.name} ${off ? "off" : "on"}`}
              onChange={(on) =>
                post({
                  type: "setup:mcpApproval",
                  name: m.name,
                  state: on ? "approved" : "rejected",
                })
              }
            />
          ) : null}
          {m.approval === "pending" ? (
            <IconButton
              icon="check"
              label={`Approve ${m.name}`}
              onClick={() => post({ type: "setup:mcpApproval", name: m.name, state: "approved" })}
            />
          ) : null}
          {m.transport !== "stdio" && m.scope !== "plugin" ? (
            <IconButton
              icon="key"
              label={`Log in to ${m.name}`}
              onClick={() => post({ type: "setup:mcpLogin", name: m.name })}
            />
          ) : null}
          {m.scope !== "plugin" ? (
            <IconButton
              icon="trash"
              label={`Remove ${m.name}`}
              onClick={() =>
                post({ type: "setup:mcpRemove", scope: m.scope as EditScope, name: m.name })
              }
            />
          ) : null}
          <button
            type="button"
            class="icon-btn"
            title="More actions"
            aria-label={`More actions for ${m.name}`}
            aria-haspopup="menu"
            onClick={(e) =>
              showMenu(mcpMenu(m, onEdit), e.currentTarget as HTMLElement, `${m.name} actions`)
            }
          >
            <Icon name="ellipsis" />
          </button>
        </>
      }
      onOpen={m.scope !== "plugin" ? () => post({ type: "setup:open", file: m.source }) : undefined}
    />
  );
}

function ServerForm({ edit, onDone }: { edit?: McpServer; onDone: () => void }) {
  const hasWs = store.setup.value?.workspace != null;
  const [scope, setScope] = useState<EditScope>(
    (edit?.scope as EditScope | undefined) ?? (hasWs ? "local" : "user"),
  );
  const [name, setName] = useState(edit?.name ?? "");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">(
    edit && (edit.transport === "http" || edit.transport === "sse") ? edit.transport : "stdio",
  );
  const [command, setCommand] = useState(
    edit?.command
      ? [edit.command, ...edit.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")
      : "",
  );
  const [url, setUrl] = useState(edit?.url ?? "");
  const [env, setEnv] = useState("");
  const [headers, setHeaders] = useState("");
  const { busy, submit: send } = useSubmit(onDone);
  const envP = parsePairs(env, ENV_KEY);
  const headP = parsePairs(headers, HEADER_KEY);
  const error =
    mcpFormError({ name, transport, command, url }) ??
    (envP.bad.length
      ? `Line ${envP.bad.join(", ")} of the environment must be KEY=value.`
      : null) ??
    (headP.bad.length ? `Line ${headP.bad.join(", ")} of the headers must be Name=value.` : null);
  const touched = name !== "" || command !== "" || url !== "";
  const submit = () => {
    if (error) return;
    const words = splitCommand(command) ?? [];
    const extra = {
      ...(Object.keys(envP.pairs).length ? { env: envP.pairs } : {}),
      ...(transport !== "stdio" && Object.keys(headP.pairs).length ? { headers: headP.pairs } : {}),
      ...(edit ? { replace: edit.name } : {}),
    };
    send(
      transport === "stdio"
        ? {
            type: "setup:mcpAdd",
            scope,
            name: name.trim(),
            transport,
            command: words[0] ?? "",
            ...(words.length > 1 ? { args: words.slice(1) } : {}),
            ...extra,
          }
        : { type: "setup:mcpAdd", scope, name: name.trim(), transport, url: url.trim(), ...extra },
    );
  };
  return (
    <div class="form">
      <h4 class="form-title">{edit ? `Edit ${edit.name}` : "Add an MCP server"}</h4>
      <Field label="Name" value={name} onInput={setName} placeholder="github" />
      <label class="field">
        <span>Type</span>
        <select
          value={transport}
          onChange={(e) => setTransport((e.target as HTMLSelectElement).value as typeof transport)}
        >
          <option value="stdio">Command on this computer</option>
          <option value="http">Remote (HTTP)</option>
          <option value="sse">Remote (SSE, older)</option>
        </select>
      </label>
      {transport === "stdio" ? (
        <Field
          label="Command"
          value={command}
          onInput={setCommand}
          placeholder="npx -y @modelcontextprotocol/server-github"
          mono
        />
      ) : (
        <Field
          label="URL"
          value={url}
          onInput={setUrl}
          placeholder="https://mcp.example.com/mcp"
          mono
        />
      )}
      <label class="field">
        <span>
          Environment variables {edit?.envKeys.length ? `(kept: ${edit.envKeys.join(", ")})` : ""}
        </span>
        <textarea
          class="mono"
          rows={3}
          value={env}
          placeholder="API_KEY=your-key (one per line)"
          onInput={(e) => setEnv((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      {transport !== "stdio" ? (
        <label class="field">
          <span>
            Headers {edit?.headerKeys.length ? `(kept: ${edit.headerKeys.join(", ")})` : ""}
          </span>
          <textarea
            class="mono"
            rows={2}
            value={headers}
            placeholder="Authorization=Bearer your-token"
            onInput={(e) => setHeaders((e.target as HTMLTextAreaElement).value)}
          />
        </label>
      ) : null}
      {edit ? null : <ScopeSelect value={scope} onChange={setScope} label="Available in" />}
      <p class="form-hint">
        Values you type here are saved in the config file; Orbit never shows saved ones again. Put
        quotes around paths with spaces.
      </p>
      <FormError text={touched ? error : null} />
      <div class="form-actions">
        <button type="button" class="btn" onClick={submit} disabled={!!error || busy}>
          {busy ? (edit ? "Saving…" : "Adding…") : edit ? "Save" : "Add"}
        </button>
        <button type="button" class="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const inScope = (m: McpServer, f: McpScopeFilter) =>
  f === "all" || (f === "plugin" ? m.scope === "plugin" : m.scope === f);

export function McpSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const page = useContext(PageMode);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [scope, setScope] = useState<McpScopeFilter>("all");
  const f = page ? scope : "all";
  const list = s.mcp.filter(
    (m) => inScope(m, f) && matches(q, m.name, m.command, m.url, m.plugin, m.scope),
  );
  const count = (x: McpScopeFilter) => s.mcp.filter((m) => inScope(m, x)).length;
  const auth = s.mcpNeedsAuth;
  return (
    <Section
      id="mcp"
      title="MCP servers"
      icon="plug"
      count={s.mcp.length}
      hidden={q.trim() !== "" && list.length === 0}
    >
      {page && auth.length ? (
        <button
          type="button"
          class="auth-banner"
          onClick={() => post({ type: "setup:run", what: "slashMcp" })}
        >
          <Icon name="warning" />
          <span>
            <b>
              {auth.length} server{auth.length === 1 ? " needs" : "s need"} signing in again
            </b>{" "}
            {auth.join(", ")}
          </span>
          <span class="auth-go">Open /mcp</span>
        </button>
      ) : null}
      {page && s.mcp.length ? (
        <Segmented<McpScopeFilter>
          legend="Show servers from"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "All", count: s.mcp.length },
            ...(count("project")
              ? [{ value: "project" as const, label: "Project", count: count("project") }]
              : []),
            ...(count("local")
              ? [{ value: "local" as const, label: "This folder", count: count("local") }]
              : []),
            { value: "user", label: "Yours", count: count("user") },
            ...(count("plugin")
              ? [{ value: "plugin" as const, label: "Plugins", count: count("plugin") }]
              : []),
          ]}
        />
      ) : null}
      {editing ? (
        <ServerForm edit={editing} onDone={() => setEditing(null)} />
      ) : list.length ? (
        <ul class="srows">
          {list.map((m) => (
            <McpRow key={`${m.scope}:${m.plugin}:${m.name}`} m={m} onEdit={() => setEditing(m)} />
          ))}
        </ul>
      ) : (
        <Empty>
          {s.mcp.length
            ? "No servers here. Try another filter."
            : "No MCP servers yet. They give Claude tools like GitHub, databases or your browser."}
        </Empty>
      )}
      {adding ? (
        <ServerForm onDone={() => setAdding(false)} />
      ) : editing ? null : (
        <div class="form-actions">
          <button type="button" class="btn secondary small" onClick={() => setAdding(true)}>
            Add server
          </button>
          {page ? (
            <button
              type="button"
              class="btn secondary small"
              title="Claude Code checks every server and shows their status"
              onClick={() => post({ type: "setup:run", what: "mcpList" })}
            >
              Check all servers
            </button>
          ) : null}
        </div>
      )}
    </Section>
  );
}

/** One server: how it connects, what it gets, and everything Claude can do with it. */
export function McpDetail({ id }: { id: string }) {
  const [editing, setEditing] = useState(false);
  const s = store.setup.value!;
  const m = s.mcp.find((x) => mcpKey(x) === id);
  if (!m) return <Gone back="All MCP servers" what="server" />;
  if (editing)
    return (
      <DetailPage back="All MCP servers" title={m.name}>
        <ServerForm edit={m} onDone={() => setEditing(false)} />
      </DetailPage>
    );
  const missing = m.transport === "stdio" && !!m.command && s.missingCommands.includes(m.command);
  const needsAuth = s.mcpNeedsAuth.includes(m.name);
  const remote = m.transport !== "stdio";
  const own = m.scope !== "plugin";
  const off = m.scope === "project" && m.approval === "rejected";
  return (
    <DetailPage
      back="All MCP servers"
      title={m.name}
      sub={m.problem ?? (m.plugin ? `From plugin ${m.plugin}` : TRANSPORT_TITLE[m.transport])}
      badges={
        <>
          <Badge>{SCOPE_LABEL[m.scope]}</Badge>
          <span class={`badge transport ${m.transport}`}>{m.transport}</span>
          {m.approval === "pending" ? <Badge tone="warn">Waiting for approval</Badge> : null}
          {off ? <Badge>Off here</Badge> : null}
          {needsAuth ? <Badge tone="warn">Needs sign-in</Badge> : null}
          {missing ? <Badge tone="warn">Command not found</Badge> : null}
        </>
      }
      actions={
        <>
          {own ? (
            <button type="button" class="btn small" onClick={() => setEditing(true)}>
              <Icon name="edit" /> Edit
            </button>
          ) : null}
          {m.scope === "project" ? (
            <button
              type="button"
              class="btn small secondary"
              onClick={() =>
                post({
                  type: "setup:mcpApproval",
                  name: m.name,
                  state: off || m.approval === "pending" ? "approved" : "rejected",
                })
              }
            >
              {off || m.approval === "pending" ? "Use it here" : "Stop using it here"}
            </button>
          ) : null}
          {remote && own ? (
            <button
              type="button"
              class="btn small secondary"
              onClick={() => post({ type: "setup:mcpLogin", name: m.name })}
            >
              <Icon name="key" /> Sign in
            </button>
          ) : null}
          <button
            type="button"
            class="btn small secondary"
            title="Claude Code connects and shows this server's status, in a terminal"
            onClick={() => post({ type: "setup:run", what: "mcpGet", name: m.name })}
          >
            <Icon name="pulse" /> Check status
          </button>
          <button
            type="button"
            class="btn small secondary"
            title="Claude Code's own MCP screen, in a terminal"
            onClick={() => post({ type: "setup:run", what: "slashMcp" })}
          >
            <Icon name="terminal" /> Open /mcp
          </button>
          <CopyButton text={m.name} label="Copy name">
            Copy name
          </CopyButton>
          {own ? (
            <button
              type="button"
              class="btn small secondary danger"
              onClick={() =>
                post({ type: "setup:mcpRemove", scope: m.scope as EditScope, name: m.name })
              }
            >
              <Icon name="trash" /> Remove…
            </button>
          ) : null}
        </>
      }
    >
      <Info
        label="Connection"
        rows={[
          ["Type", TRANSPORT_TITLE[m.transport] ?? m.transport],
          [
            "Runs",
            m.command ? (
              <code key="c" class="srow-mono wrap">
                {[m.command, ...m.args].join(" ")}
              </code>
            ) : null,
          ],
          [
            "Address",
            m.url ? (
              <code key="u" class="srow-mono wrap">
                {m.url}
              </code>
            ) : null,
          ],
          [
            "Command found",
            m.transport === "stdio" && m.command
              ? missing
                ? "No: it isn't on PATH"
                : "Yes"
              : null,
          ],
        ]}
      />
      <Info
        label="What it's given"
        rows={[
          ["Environment", m.envKeys.length ? m.envKeys.join(", ") : "Nothing extra"],
          ["Headers", remote ? (m.headerKeys.length ? m.headerKeys.join(", ") : "None") : null],
          [
            "Values",
            m.envKeys.length || m.headerKeys.length
              ? "Orbit never shows saved values. Open the config file to see them."
              : null,
          ],
        ]}
      />
      <Info
        label="Where it's set up"
        rows={[
          ["Available in", SCOPE_LABEL[m.scope]],
          [
            "Approval",
            m.scope === "project"
              ? m.approval === "approved"
                ? "You approved it"
                : m.approval === "rejected"
                  ? "Turned off in this folder"
                  : "Not approved yet"
              : null,
          ],
          [
            "File",
            own ? (
              <button
                type="button"
                class="link-btn"
                onClick={() => post({ type: "setup:open", file: m.source })}
              >
                {m.source}
              </button>
            ) : (
              m.source
            ),
          ],
        ]}
      />
    </DetailPage>
  );
}
