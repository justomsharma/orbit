import { post } from "../bus";
import * as store from "../store";
import { Badge, Empty, matches, Row, Section, Switch } from "./parts";

export function PluginsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const list = s.plugins.filter((p) => matches(q, p.name, p.marketplace, p.description));
  const on = s.plugins.filter((p) => p.enabled).length;
  return (
    <Section
      id="plugins"
      title="Plugins"
      icon="extensions"
      count={s.plugins.length}
      note={s.plugins.length ? `${on} on` : undefined}
      hidden={q.trim() !== "" && list.length === 0}
    >
      {list.length ? (
        <ul class="srows">
          {list.map((p) => {
            const c = p.counts;
            const parts = [
              c.skills && `${c.skills} skill${c.skills === 1 ? "" : "s"}`,
              c.agents && `${c.agents} agent${c.agents === 1 ? "" : "s"}`,
              c.commands && `${c.commands} command${c.commands === 1 ? "" : "s"}`,
              c.hooks && `${c.hooks} hook${c.hooks === 1 ? "" : "s"}`,
              c.mcpServers && `${c.mcpServers} MCP`,
            ].filter(Boolean);
            return (
              <Row
                key={`${p.id}:${p.scope}`}
                title={p.name}
                sub={p.problem ?? p.description ?? parts.join(" · ")}
                badges={
                  <>
                    <Badge title={p.marketplace}>
                      {p.version === "unknown" ? p.marketplace : `v${p.version}`}
                    </Badge>
                    {p.problem ? <Badge tone="warn">Needs attention</Badge> : null}
                  </>
                }
                actions={
                  <Switch
                    on={p.enabled}
                    label={`${p.name} ${p.enabled ? "on" : "off"}`}
                    onChange={(enabled) =>
                      post({ type: "setup:plugin", id: p.id, enabled, scope: "user" })
                    }
                  />
                }
              />
            );
          })}
        </ul>
      ) : (
        <Empty>No plugins installed. Install some in Claude Code with /plugin.</Empty>
      )}
    </Section>
  );
}
