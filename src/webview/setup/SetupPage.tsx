import type { ComponentType } from "preact";
import type { OrbitLink } from "../../shared/links";
import type { Tab } from "../../shared/tabs";
import { post } from "../bus";
import * as store from "../store";
import { Icon, IconButton } from "../ui/Icon";
import { AgentsSection, CommandsSection, SkillsSection } from "./ContentSections";
import { HooksSection } from "./HooksSection";
import { McpSection } from "./McpSection";
import { MemorySection } from "./MemorySection";
import { PluginsSection } from "./PluginsSection";
import { PageMode } from "./parts";

type SetupTab = Exclude<
  Tab,
  "home" | "chats" | "prompts" | "checkpoints" | "usage" | "account" | "config"
>;

const PAGES: Record<
  SetupTab,
  { body: ComponentType; search: string; browse?: { link: OrbitLink; label: string } }
> = {
  skills: {
    body: SkillsSection,
    search: "Search skills",
    browse: { link: "skills", label: "Find more skills (opens GitHub)" },
  },
  mcp: {
    body: McpSection,
    search: "Search MCP servers",
    browse: { link: "mcp", label: "Find more MCP servers (opens GitHub)" },
  },
  plugins: { body: PluginsSection, search: "Search plugins" },
  agents: { body: AgentsSection, search: "Search agents" },
  commands: { body: CommandsSection, search: "Search commands" },
  hooks: { body: HooksSection, search: "Search hooks" },
  memory: { body: MemorySection, search: "Search memory" },
};

/** Search, browse and refresh above the page. */
export function SetupToolbar({
  placeholder,
  browse,
}: {
  placeholder: string;
  browse?: { link: OrbitLink; label: string };
}) {
  return (
    <div class="toolbar setup-toolbar">
      <div class="search">
        <Icon name="search" />
        <input
          type="search"
          placeholder={placeholder}
          aria-label={placeholder}
          value={store.setupQuery.value}
          onInput={(e) => (store.setupQuery.value = (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") store.setupQuery.value = "";
          }}
        />
      </div>
      {browse ? (
        <IconButton
          icon="globe"
          label={browse.label}
          onClick={() => post({ type: "openOrbitLink", link: browse.link })}
        />
      ) : null}
      <IconButton icon="refresh" label="Refresh" onClick={() => post({ type: "setup:refresh" })} />
    </div>
  );
}

/** One part of Claude Code's setup as a tab of its own. */
export function SetupPage({ page }: { page: Tab }) {
  const p = PAGES[page as SetupTab];
  if (!p) return null;
  const Body = p.body;
  return (
    <section class="setup scroll">
      <SetupToolbar placeholder={p.search} browse={p.browse} />
      {store.setup.value ? (
        <PageMode.Provider value={true}>
          <Body />
        </PageMode.Provider>
      ) : (
        <div class="loading" role="status">
          Reading your setup…
        </div>
      )}
      <p class="hero-note">Every change keeps a backup and can be undone. Risky ones ask first.</p>
    </section>
  );
}
