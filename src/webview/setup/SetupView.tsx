import { post } from "../bus";
import * as store from "../store";
import { Icon, IconButton } from "../ui/Icon";
import { AgentsSection, CommandsSection, SkillsSection } from "./ContentSections";
import { HealthSection } from "./HealthSection";
import { HooksSection } from "./HooksSection";
import { McpSection } from "./McpSection";
import { MemorySection } from "./MemorySection";
import { PermissionsSection } from "./PermissionsSection";
import { PluginsSection } from "./PluginsSection";
import { SettingsSection } from "./SettingsSection";

/** Everything about the person's Claude Code setup, health first. */
export function SetupView() {
  const s = store.setup.value;
  if (!s) {
    return (
      <div class="loading" role="status">
        Reading your setup…
      </div>
    );
  }
  return (
    <section class="setup scroll">
      <div class="toolbar setup-toolbar">
        <div class="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search setup"
            aria-label="Search setup"
            value={store.setupQuery.value}
            onInput={(e) => (store.setupQuery.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") store.setupQuery.value = "";
            }}
          />
        </div>
        <IconButton
          icon="refresh"
          label="Refresh setup"
          onClick={() => post({ type: "setup:refresh" })}
        />
      </div>
      <HealthSection />
      <McpSection />
      <PluginsSection />
      <SkillsSection />
      <AgentsSection />
      <CommandsSection />
      <HooksSection />
      <PermissionsSection />
      <MemorySection />
      <SettingsSection />
      <p class="hero-note">Every change asks first, keeps a backup and can be undone.</p>
    </section>
  );
}
