import { useState } from "preact/hooks";
import type { McpServer } from "../../features/setup/mcp";
import { mcpFormError, splitCommand } from "../../shared/validate";
import { post } from "../bus";
import * as store from "../store";
import { IconButton } from "../ui/Icon";
import {
  Badge,
  type EditScope,
  Empty,
  Field,
  FormError,
  matches,
  Row,
  SCOPE_LABEL,
  ScopeSelect,
  Section,
  useSubmit,
} from "./parts";

function McpRow({ m }: { m: McpServer }) {
  const where = m.command ? [m.command, ...m.args].join(" ") : (m.url ?? "");
  const editable = m.scope !== "plugin";
  return (
    <Row
      title={m.name}
      sub={
        m.plugin
          ? `From plugin ${m.plugin}`
          : m.envKeys.length
            ? `Uses ${m.envKeys.join(", ")}`
            : null
      }
      mono={where}
      badges={
        <>
          <Badge>{SCOPE_LABEL[m.scope]}</Badge>
          <Badge>{m.transport}</Badge>
          {m.approval === "pending" ? <Badge tone="warn">Waiting for approval</Badge> : null}
          {m.approval === "rejected" ? <Badge tone="error">Rejected</Badge> : null}
        </>
      }
      actions={
        <>
          {m.approval === "pending" || m.approval === "rejected" ? (
            <IconButton
              icon="check"
              label={`Approve ${m.name}`}
              onClick={() => post({ type: "setup:mcpApproval", name: m.name, state: "approved" })}
            />
          ) : null}
          {m.scope === "project" && m.approval === "approved" ? (
            <IconButton
              icon="circle-slash"
              label={`Stop using ${m.name} in this folder`}
              onClick={() => post({ type: "setup:mcpApproval", name: m.name, state: "rejected" })}
            />
          ) : null}
          {m.transport !== "stdio" ? (
            <IconButton
              icon="key"
              label={`Log in to ${m.name}`}
              onClick={() => post({ type: "setup:mcpLogin", name: m.name })}
            />
          ) : null}
          {editable ? (
            <IconButton
              icon="trash"
              label={`Remove ${m.name}`}
              onClick={() =>
                post({ type: "setup:mcpRemove", scope: m.scope as EditScope, name: m.name })
              }
            />
          ) : null}
        </>
      }
      onOpen={editable ? () => post({ type: "setup:open", file: m.source }) : undefined}
    />
  );
}

function AddServer({ onDone }: { onDone: () => void }) {
  const hasWs = store.setup.value?.workspace != null;
  const [scope, setScope] = useState<EditScope>(hasWs ? "local" : "user");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const { busy, submit: send } = useSubmit(onDone);
  const error = mcpFormError({ name, transport, command, url });
  const touched = name !== "" || command !== "" || url !== "";
  const submit = () => {
    if (error) return;
    const words = splitCommand(command) ?? [];
    send(
      transport === "stdio"
        ? {
            type: "setup:mcpAdd",
            scope,
            name: name.trim(),
            transport,
            command: words[0] ?? "",
            ...(words.length > 1 ? { args: words.slice(1) } : {}),
          }
        : { type: "setup:mcpAdd", scope, name: name.trim(), transport, url: url.trim() },
    );
  };
  return (
    <div class="form">
      <Field label="Name" value={name} onInput={setName} placeholder="github" />
      <label class="field">
        <span>Type</span>
        <select
          value={transport}
          onChange={(e) => setTransport((e.target as HTMLSelectElement).value as typeof transport)}
        >
          <option value="stdio">Command on this computer</option>
          <option value="http">Remote (HTTP)</option>
          <option value="sse">Remote (SSE)</option>
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
      <ScopeSelect value={scope} onChange={setScope} label="Available in" />
      <p class="form-hint">
        API keys: add them afterwards in the file, or with Log in for remote servers. Put quotes
        around paths with spaces.
      </p>
      <FormError text={touched ? error : null} />
      <div class="form-actions">
        <button type="button" class="btn" onClick={submit} disabled={!!error || busy}>
          {busy ? "Adding…" : "Add"}
        </button>
        <button type="button" class="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function McpSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const [adding, setAdding] = useState(false);
  const list = s.mcp.filter((m) => matches(q, m.name, m.command, m.url, m.plugin, m.scope));
  return (
    <Section
      id="mcp"
      title="MCP servers"
      icon="plug"
      count={s.mcp.length}
      hidden={q.trim() !== "" && list.length === 0}
    >
      {list.length ? (
        <ul class="srows">
          {list.map((m) => (
            <McpRow key={`${m.scope}:${m.plugin}:${m.name}`} m={m} />
          ))}
        </ul>
      ) : (
        <Empty>
          No MCP servers yet. They give Claude tools like GitHub, databases or your browser.
        </Empty>
      )}
      {adding ? (
        <AddServer onDone={() => setAdding(false)} />
      ) : (
        <button type="button" class="btn secondary small" onClick={() => setAdding(true)}>
          Add server
        </button>
      )}
    </Section>
  );
}
