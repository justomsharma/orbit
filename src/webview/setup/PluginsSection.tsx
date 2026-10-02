import { useContext } from "preact/hooks";
import type { InstalledPlugin } from "../../features/setup/plugins";
import { post } from "../bus";
import { relativeTime } from "../chats/model";
import * as store from "../store";
import { Icon } from "../ui/Icon";
import { type MenuItem, showMenu } from "../ui/Menu";
import { Segmented } from "../ui/Segmented";
import { CopyButton, DetailPage, Gone, Info, openDetail } from "./Detail";
import {
  Badge,
  decided,
  Empty,
  LOCKED,
  matches,
  PageMode,
  PRECEDENCE,
  Row,
  Section,
  Switch,
} from "./parts";

export type PluginView = "all" | "issues" | "sources";

const WHOSE: Record<string, string> = {
  managed: "your organisation's",
  local: "this folder's",
  project: "your project's",
  user: "your",
};
const SHORT: Record<string, string> = {
  managed: "Organisation",
  local: "This folder",
  project: "Project",
  user: "You",
};

/** Every settings file that turns the plugin on or off, the one that decides first. */
export function chainOf(id: string): { scope: string; on: boolean }[] {
  const files = store.setup.value?.settings ?? [];
  const out: { scope: string; on: boolean }[] = [];
  for (const scope of PRECEDENCE) {
    const v = files.find((f) => f.scope === scope)?.values.enabledPlugins;
    if (v && "entries" in v && typeof v.entries[id] === "boolean")
      out.push({ scope, on: v.entries[id] as boolean });
  }
  return out;
}

function trustOf(p: InstalledPlugin): { label: string; tone: "plain" | "warn" | "ok" } {
  const m = store.setup.value?.marketplaces.find((x) => x.name === p.marketplace);
  if (!m) return { label: "Unknown source", tone: "warn" };
  return m.official ? { label: "Official", tone: "ok" } : { label: "Added by you", tone: "plain" };
}

function statusOf(p: InstalledPlugin): { label: string; tone: "plain" | "warn" | "ok" } {
  if (!p.installPath) return { label: "Not installed", tone: "warn" };
  if (p.problem) return { label: "Needs attention", tone: "warn" };
  return p.enabled ? { label: "On", tone: "ok" } : { label: "Off", tone: "plain" };
}

const hasIssue = (p: InstalledPlugin) => !!p.problem || trustOf(p).tone === "warn";

function countsText(p: InstalledPlugin): string[] {
  const c = p.counts;
  const n = (k: number, one: string) => (k ? `${k} ${one}${k === 1 ? "" : "s"}` : null);
  return [
    n(c.skills, "skill"),
    n(c.agents, "agent"),
    n(c.commands, "command"),
    n(c.hooks, "hook"),
    c.mcpServers ? `${c.mcpServers} MCP server${c.mcpServers === 1 ? "" : "s"}` : null,
  ].filter((x): x is string => !!x);
}

function Chain({ id }: { id: string }) {
  const chain = chainOf(id);
  if (!chain.length) return <span class="srow-sub">Not turned on in any settings file</span>;
  return (
    <span class="plugin-chain">
      <span class="srow-sub">Decided by {WHOSE[chain[0]!.scope]} settings</span>
      <span class="tags inline">
        {chain.map((c, i) => (
          <span key={c.scope} class={`tag${i === 0 ? "" : " more"}`}>
            {SHORT[c.scope]}: {c.on ? "on" : "off"}
          </span>
        ))}
      </span>
    </span>
  );
}

function pluginMenu(p: InstalledPlugin): MenuItem[] {
  const s = store.setup.value!;
  const locked = decided("enabledPlugins", p.id)?.scope === "managed";
  const items: MenuItem[] = [];
  if (!locked) {
    const set = (scope: "user" | "project" | "local", on: boolean, label: string) =>
      items.push({
        label,
        icon: on ? "check" : "circle-slash",
        run: () => post({ type: "setup:plugin", id: p.id, enabled: on, scope }),
      });
    set("user", !p.enabled, p.enabled ? "Turn off for you" : "Turn on for you");
    if (s.workspace) {
      set(
        "project",
        !p.enabled,
        p.enabled ? "Turn off for this project" : "Turn on for this project",
      );
      set(
        "local",
        !p.enabled,
        p.enabled ? "Turn off just in this folder" : "Turn on just in this folder",
      );
    }
  }
  if (p.installPath)
    items.push({
      label: "Open plugin folder",
      icon: "folder-opened",
      run: () => post({ type: "setup:revealPlugin", id: p.id }),
    });
  items.push({
    label: "Copy id",
    icon: "copy",
    run: () => void navigator.clipboard?.writeText(p.id),
  });
  for (const f of s.settings)
    if (f.exists && f.scope !== "managed")
      items.push({
        label: `Open ${SHORT[f.scope]?.toLowerCase() === "you" ? "your" : WHOSE[f.scope]} settings`,
        icon: "go-to-file",
        run: () => post({ type: "setup:open", file: f.path }),
      });
  return items;
}

function PluginSwitch({ p }: { p: InstalledPlugin }) {
  return (
    <Switch
      on={p.enabled}
      disabled={decided("enabledPlugins", p.id)?.scope === "managed"}
      label={`${p.name} ${p.enabled ? "on" : "off"}`}
      onChange={(enabled) => post({ type: "setup:plugin", id: p.id, enabled, scope: "auto" })}
    />
  );
}

function Sources() {
  const s = store.setup.value!;
  const managed = s.settings.find((f) => f.scope === "managed" && f.exists);
  const rules = Object.entries(managed?.values ?? {}).filter(([k]) =>
    /plugin|marketplace/i.test(k),
  );
  const now = store.now.value;
  return (
    <>
      <section class="detail-block" aria-label="Marketplaces">
        <h4 class="subgroup-title">Marketplaces</h4>
        {s.marketplaces.length ? (
          <ul class="srows">
            {s.marketplaces.map((m) => (
              <Row
                key={m.name}
                title={m.name}
                mono={m.source}
                sub={m.lastUpdated ? `Updated ${relativeTime(m.lastUpdated, now)}` : null}
                badges={
                  m.official ? <Badge tone="ok">Official</Badge> : <Badge>Added by you</Badge>
                }
              />
            ))}
          </ul>
        ) : (
          <Empty>No marketplaces yet. Add one in Claude Code with /plugin.</Empty>
        )}
      </section>
      <section class="detail-block" aria-label="Your organisation's plugin rules">
        <h4 class="subgroup-title">Your organisation's plugin rules</h4>
        {rules.length ? (
          <ul class="srows">
            {rules.map(([k, v]) => (
              <Row
                key={k}
                title={k}
                sub={
                  "value" in v
                    ? String(v.value)
                    : "entries" in v
                      ? `${Object.keys(v.entries).length} entries`
                      : "keys" in v
                        ? `${v.keys.length} entries`
                        : "count" in v
                          ? `${v.count} entries`
                          : "Set (hidden)"
                }
                badges={<Badge title={LOCKED}>Managed</Badge>}
              />
            ))}
          </ul>
        ) : (
          <p class="muted">No organisation rules about plugins.</p>
        )}
      </section>
    </>
  );
}

export function PluginsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const page = useContext(PageMode);
  const view = page ? store.pluginView.value : "all";
  const searched = s.plugins.filter((p) => matches(q, p.name, p.marketplace, p.description, p.id));
  const list = view === "issues" ? searched.filter(hasIssue) : searched;
  const on = s.plugins.filter((p) => p.enabled).length;
  const row = (p: InstalledPlugin) => {
    const st = statusOf(p);
    const trust = trustOf(p);
    return (
      <Row
        key={`${p.id}:${p.scope}`}
        title={p.name}
        sub={p.problem ?? p.description ?? countsText(p).join(" · ")}
        badges={
          <>
            <Badge tone={st.tone}>{st.label}</Badge>
            {p.version && p.version !== "unknown" ? (
              <Badge title={p.marketplace}>v{p.version}</Badge>
            ) : null}
            {trust.tone === "ok" ? null : <Badge tone={trust.tone}>{trust.label}</Badge>}
          </>
        }
        extra={page ? <Chain id={p.id} /> : null}
        onSelect={page ? () => openDetail("plugins", p.id) : undefined}
        actions={
          <>
            <PluginSwitch p={p} />
            {page ? (
              <button
                type="button"
                class="icon-btn"
                title="More actions"
                aria-label={`More actions for ${p.name}`}
                aria-haspopup="menu"
                onClick={(e) =>
                  showMenu(pluginMenu(p), e.currentTarget as HTMLElement, `${p.name} actions`)
                }
              >
                <Icon name="ellipsis" />
              </button>
            ) : null}
          </>
        }
      />
    );
  };
  return (
    <Section
      id="plugins"
      title="Plugins"
      icon="extensions"
      count={s.plugins.length}
      note={s.plugins.length ? `${on} on` : undefined}
      hidden={q.trim() !== "" && list.length === 0}
    >
      {page ? (
        <Segmented<PluginView>
          legend="Show"
          value={view}
          onChange={(v) => (store.pluginView.value = v)}
          options={[
            { value: "all", label: "All", count: s.plugins.length },
            { value: "issues", label: "Issues", count: s.plugins.filter(hasIssue).length },
            { value: "sources", label: "Sources", count: s.marketplaces.length },
          ]}
        />
      ) : null}
      {view === "sources" ? (
        <Sources />
      ) : list.length ? (
        <ul class="srows">{list.map(row)}</ul>
      ) : (
        <Empty>
          {view === "issues"
            ? "No problems with your plugins."
            : "No plugins installed. Install some in Claude Code with /plugin."}
        </Empty>
      )}
    </Section>
  );
}

/** One plugin: what it is, where it's turned on, what's inside. */
export function PluginDetail({ id }: { id: string }) {
  const p = store.setup.value?.plugins.find((x) => x.id === id);
  if (!p) return <Gone back="All plugins" what="plugin" />;
  const st = statusOf(p);
  const trust = trustOf(p);
  const chain = chainOf(p.id);
  const locked = decided("enabledPlugins", p.id)?.scope === "managed";
  const counts = countsText(p);
  return (
    <DetailPage
      back="All plugins"
      title={p.name}
      sub={p.description}
      badges={
        <>
          <Badge tone={st.tone}>{st.label}</Badge>
          <Badge tone={trust.tone}>{trust.label}</Badge>
        </>
      }
      actions={
        <>
          <button
            type="button"
            class="btn small"
            disabled={locked}
            title={locked ? LOCKED : "Changes the settings file that decides it"}
            onClick={() =>
              post({ type: "setup:plugin", id: p.id, enabled: !p.enabled, scope: "auto" })
            }
          >
            <Icon name={p.enabled ? "circle-slash" : "check"} />{" "}
            {p.enabled ? "Turn off" : "Turn on"}
          </button>
          {p.installPath ? (
            <button
              type="button"
              class="btn small secondary"
              onClick={() => post({ type: "setup:revealPlugin", id: p.id })}
            >
              <Icon name="folder-opened" /> Open folder
            </button>
          ) : null}
          <CopyButton text={p.id} label="Copy id">
            Copy id
          </CopyButton>
          <button
            type="button"
            class="btn small secondary"
            title="Claude Code's own plugin screen, in a terminal"
            onClick={() => post({ type: "setup:run", what: "slashPlugin" })}
          >
            <Icon name="terminal" /> Open /plugin
          </button>
        </>
      }
    >
      {p.problem ? <p class="detail-problems">{p.problem}</p> : null}
      <Info
        label="Plugin"
        rows={[
          ["Id", <code key="i">{p.id}</code>],
          ["Marketplace", `${p.marketplace} (${trust.label.toLowerCase()})`],
          ["Version", p.version && p.version !== "unknown" ? p.version : null],
          ["Installed for", p.scope === "user" ? "You (every project)" : SHORT[p.scope]],
          [
            "Folder",
            p.installPath ? (
              <code key="f" class="srow-mono">
                {p.installPath}
              </code>
            ) : null,
          ],
        ]}
      />
      <Info
        label="Turned on or off"
        rows={[
          ["Now", p.enabled ? "On" : "Off"],
          [
            "Decided by",
            chain.length ? `${WHOSE[chain[0]!.scope]} settings` : "No settings file names it",
          ],
          ...chain.map((c): [string, string] => [
            `${SHORT[c.scope]} settings`,
            c.on ? "on" : "off",
          ]),
        ]}
      />
      <section class="detail-block" aria-label="What's inside">
        <h4 class="subgroup-title">What's inside</h4>
        {counts.length ? (
          <ul class="tags">
            {counts.map((c) => (
              <li key={c} class="tag">
                {c}
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">Nothing Orbit can count.</p>
        )}
      </section>
    </DetailPage>
  );
}
