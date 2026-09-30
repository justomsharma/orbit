// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import { settingsCatalog } from "../../../features/setup/catalog";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { SetupView } from "../SetupView";

const sent: ViewMsg[] = [];

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = sampleSetup();
  store.catalog.value = settingsCatalog();
  store.setupQuery.value = "";
  store.openSections.value = [
    "health",
    "mcp",
    "plugins",
    "skills",
    "hooks",
    "permissions",
    "memory",
    "settings",
    "agents",
    "commands",
  ];
});
afterEach(cleanup);

const section = (name: RegExp) => screen.getByRole("group", { name });

describe("SetupView", () => {
  it("waits politely for the first read", () => {
    store.setup.value = null;
    render(<SetupView />);
    expect(screen.getByText(/Reading your setup/)).toBeTruthy();
  });

  it("leads with health: each issue with its own fix", () => {
    render(<SetupView />);
    const health = section(/Health/);
    expect(within(health).getByText(/Unknown setting "thme"/)).toBeTruthy();
    fireEvent.click(within(health).getByRole("button", { name: /Approve/ }));
    fireEvent.click(within(health).getByRole("button", { name: /Fix with Claude/ }));
    expect(sent).toContainEqual({ type: "setup:mcpApproval", name: "postgres", state: "approved" });
    expect(sent).toContainEqual({
      type: "setup:fixWithClaude",
      issueId: "settings-unknown:user:thme",
    });
  });

  it("celebrates a healthy setup", () => {
    store.setup.value = sampleSetup({ issues: [] });
    render(<SetupView />);
    expect(screen.getByText(/Everything looks good/)).toBeTruthy();
  });

  it("lists MCP servers with scope and never shows secret values", () => {
    render(<SetupView />);
    const mcp = section(/MCP servers/);
    expect(within(mcp).getByText("github")).toBeTruthy();
    expect(within(mcp).getByText("postgres")).toBeTruthy();
    expect(within(mcp).getByText(/Waiting for approval/)).toBeTruthy();
    fireEvent.click(within(mcp).getAllByRole("button", { name: /Remove github/ })[0]!);
    expect(sent).toContainEqual({ type: "setup:mcpRemove", scope: "user", name: "github" });
  });

  it("adds an MCP server from a small form", () => {
    render(<SetupView />);
    const mcp = section(/MCP servers/);
    fireEvent.click(within(mcp).getByRole("button", { name: /Add server/ }));
    fireEvent.input(within(mcp).getByLabelText("Name"), { target: { value: "linear" } });
    fireEvent.change(within(mcp).getByLabelText("Type"), { target: { value: "http" } });
    fireEvent.input(within(mcp).getByLabelText("URL"), {
      target: { value: "https://mcp.linear.app/mcp" },
    });
    fireEvent.click(within(mcp).getByRole("button", { name: /^Add$/ }));
    expect(sent).toContainEqual({
      type: "setup:mcpAdd",
      scope: "local",
      name: "linear",
      transport: "http",
      url: "https://mcp.linear.app/mcp",
    });
  });

  it("turns a plugin on with a switch", () => {
    render(<SetupView />);
    const plugins = section(/Plugins/);
    fireEvent.click(within(plugins).getByRole("switch", { name: /frontend-design/ }));
    expect(sent).toContainEqual({
      type: "setup:plugin",
      id: "frontend-design@claude-plugins-official",
      enabled: true,
      scope: "user",
    });
  });

  it("hides a skill from Claude and opens its file", () => {
    render(<SetupView />);
    const skills = section(/Skills/);
    fireEvent.change(within(skills).getByLabelText(/release-notes visibility/), {
      target: { value: "off" },
    });
    expect(sent).toContainEqual({
      type: "setup:skillVisibility",
      name: "release-notes",
      visibility: "off",
    });
    fireEvent.click(within(skills).getByRole("button", { name: /Open release-notes/ }));
    expect(sent).toContainEqual({
      type: "setup:open",
      file: "/Users/ana/code/shop/.claude/skills/release-notes/SKILL.md",
    });
  });

  it("creates a new skill", () => {
    render(<SetupView />);
    const skills = section(/Skills/);
    fireEvent.click(within(skills).getByRole("button", { name: /New skill/ }));
    fireEvent.input(within(skills).getByLabelText("Name"), { target: { value: "triage" } });
    fireEvent.input(within(skills).getByLabelText("Description"), {
      target: { value: "Triage new issues" },
    });
    fireEvent.click(within(skills).getByRole("button", { name: /^Create$/ }));
    expect(sent).toContainEqual({
      type: "setup:new",
      kind: "skill",
      scope: "user",
      name: "triage",
      description: "Triage new issues",
    });
  });

  it("removes a hook and pauses all hooks", () => {
    render(<SetupView />);
    const hooks = section(/Hooks/);
    fireEvent.click(within(hooks).getAllByRole("button", { name: /Remove hook/ })[0]!);
    expect(sent[0]).toMatchObject({ type: "setup:hookRemove" });
    fireEvent.click(within(hooks).getByRole("switch", { name: /Pause all hooks/ }));
    expect(sent).toContainEqual({ type: "setup:hooksPaused", paused: true });
  });

  it("adds a permission rule", () => {
    render(<SetupView />);
    const perms = section(/Permissions/);
    fireEvent.input(within(perms).getByLabelText("New rule"), {
      target: { value: "Bash(npm run lint)" },
    });
    fireEvent.click(within(perms).getByRole("button", { name: /Add rule/ }));
    expect(sent).toContainEqual({
      type: "setup:rule",
      op: "add",
      scope: "user",
      list: "allow",
      rule: "Bash(npm run lint)",
    });
  });

  it("offers to create a missing project CLAUDE.md", () => {
    render(<SetupView />);
    const memory = section(/Memory/);
    fireEvent.click(within(memory).getAllByRole("button", { name: /Create/ })[0]!);
    expect(sent[0]).toMatchObject({ type: "setup:createClaudeMd" });
  });

  it("edits a setting in the chosen scope, driven by Claude's own schema", () => {
    render(<SetupView />);
    const settings = section(/Settings/);
    fireEvent.change(within(settings).getByLabelText("Effort level"), {
      target: { value: "xhigh" },
    });
    expect(sent).toContainEqual({
      type: "setup:setSetting",
      scope: "user",
      key: "effortLevel",
      value: "xhigh",
    });
    expect(within(settings).getAllByText(/set in shared project/i).length).toBeGreaterThan(0);
  });

  it("searches across the whole setup", () => {
    render(<SetupView />);
    fireEvent.input(screen.getByRole("searchbox", { name: /Search setup/ }), {
      target: { value: "postgres" },
    });
    expect(screen.getAllByText("postgres").length).toBeGreaterThan(0);
    expect(screen.queryByText("reviewer")).toBeNull();
  });
});
