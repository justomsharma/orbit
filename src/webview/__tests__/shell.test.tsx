// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../test/helpers/setupFixture";
import { sampleUsage } from "../../../test/helpers/usageFixture";
import type { Session } from "../../features/chats/types";
import type { ViewMsg } from "../../shared/protocol";
import { TABS } from "../../shared/tabs";
import { AccountView } from "../account/AccountView";
import { App } from "../app";
import { setPost } from "../bus";
import { CheckpointsView, formatBytes } from "../checkpoints/CheckpointsView";
import { ConfigView } from "../setup/ConfigView";
import { SetupPage } from "../setup/SetupPage";
import * as store from "../store";
import { EDGE_ZONE, edgeVelocity, MAX_SPEED } from "../ui/edgeScroll";
import { glance } from "../usage/glance";

const sent: ViewMsg[] = [];
const ID = "00000000-0000-4000-8000-000000000001";
const chat: Session = {
  id: ID,
  file: "",
  cwd: "/code/shop",
  project: "shop",
  title: "Fix checkout race",
  firstPrompt: "",
  branch: "main",
  startedAt: Date.now() - 3600_000,
  lastActiveAt: Date.now() - 600_000,
  prompts: 5,
  estimated: false,
  model: null,
  entrypoint: "cli",
  prLinks: [],
  continuedIn: null,
  sizeBytes: 1,
};

const loadSessions = (welcomed = true) =>
  store.applyHostMessage({
    type: "sessions",
    items: [chat],
    live: [],
    pins: [],
    renames: {},
    tags: {},
    here: [ID],
    onboarding: { done: [], dismissed: true, welcomed },
    env: {
      claudeExtension: true,
      hasWorkspace: true,
      platform: "linux",
      prefs: { openChatsIn: "terminal", terminalLocation: "editor" },
    },
  });

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.tab.value = "home";
  store.details.value = null;
  store.welcome.value = false;
  store.setup.value = sampleSetup();
  store.usage.value = sampleUsage();
  store.account.value = null;
  store.checkpoints.value = null;
  store.cpOpen.value = null;
  store.setupQuery.value = "";
  store.skillScope.value = "all";
  loadSessions();
});
afterEach(cleanup);

describe("tab bar", () => {
  it("follows your tab order and hides the tabs you hid", () => {
    render(<App />);
    store.applyHostMessage({
      type: "sessions",
      items: [chat],
      live: [],
      pins: [],
      renames: {},
      tags: {},
      here: [ID],
      onboarding: { done: [], dismissed: true, welcomed: true },
      env: {
        claudeExtension: true,
        hasWorkspace: true,
        platform: "linux",
        prefs: {
          openChatsIn: "terminal",
          terminalLocation: "editor",
          tabOrder: ["usage"],
          hiddenTabs: ["memory", "home"],
        },
      },
    });
    return waitFor(() => {
      const tabs = screen.getAllByRole("tab").map((t) => t.getAttribute("title"));
      expect(tabs[0]).toBe("Usage");
      expect(tabs).not.toContain("Memory");
      expect(store.tab.value).toBe("usage");
    });
  });

  it("has every tab, names only the open one, and moves with the arrow keys and Home/End", () => {
    render(<App />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("title"))).toEqual(TABS.map((t) => t.label));
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Home");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(store.tab.value).toBe("chats");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(store.tab.value).toBe("memory");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(store.tab.value).toBe("home");
  });

  it("tells the host what data the open tab needs", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(sent).toContainEqual({ type: "tab", tab: "setup" });
    fireEvent.click(screen.getByRole("tab", { name: "Account" }));
    expect(sent).toContainEqual({ type: "tab", tab: "account" });
  });

  it("scrolls faster the deeper the pointer is in an edge, and not at all in the middle", () => {
    expect(edgeVelocity(0, 300)).toBe(-MAX_SPEED);
    expect(edgeVelocity(EDGE_ZONE / 2, 300)).toBeCloseTo(-MAX_SPEED / 2);
    expect(edgeVelocity(150, 300)).toBe(0);
    expect(edgeVelocity(300, 300)).toBe(MAX_SPEED);
    expect(edgeVelocity(10, 60)).toBe(0);
  });

  it("opens Orbit's own links from the footer", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Orbit on GitHub" }));
    expect(sent).toContainEqual({ type: "openOrbitLink", link: "repo" });
  });
});

describe("welcome", () => {
  it("shows once on first run, lists every tab, and takes you to the one you pick", () => {
    loadSessions(false);
    render(<App />);
    const dialog = screen.getByRole("dialog", { name: /Welcome to Orbit/ });
    expect(within(dialog).getAllByRole("button").length).toBe(TABS.length + 1);
    fireEvent.click(within(dialog).getByRole("button", { name: /Checkpoints/ }));
    expect(store.tab.value).toBe("checkpoints");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent).toContainEqual({ type: "onboarding", action: "welcomed" });
    loadSessions(false);
    expect(store.welcome.value).toBe(false);
  });

  it("can be opened again from the footer", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "What's in Orbit" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("restores tabs saved by older versions", () => {
    expect(store.restoredTab({ tab: "setup" })).toBe("config");
    expect(store.restoredTab({ tab: "chats", chatsMode: "prompts" })).toBe("prompts");
    expect(store.restoredTab({ tab: "nope" })).toBe("home");
  });
});

describe("Config", () => {
  it("changes the model and effort in one click, without a question first", () => {
    render(<ConfigView />);
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "sonnet" } });
    expect(sent).toContainEqual({
      type: "setup:setSetting",
      scope: "auto",
      key: "model",
      value: "sonnet",
      quick: true,
    });
    expect(screen.getByText("Balanced daily driver")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reasoning effort"), { target: { value: "" } });
    expect(sent).toContainEqual({
      type: "setup:setSetting",
      scope: "auto",
      key: "effortLevel",
      value: null,
      quick: true,
    });
  });

  it("writes off for settings that are on by default, and removes the key to turn them back on", () => {
    render(<ConfigView />);
    const box = screen.getByRole("checkbox", { name: "Auto-compact" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(sent.at(-1)).toMatchObject({ key: "autoCompactEnabled", value: false });
  });

  it("blocks bypass mode with Claude's own value", () => {
    render(<ConfigView />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Block bypass-permissions mode" }));
    expect(sent.at(-1)).toMatchObject({
      key: "permissions.disableBypassPermissionsMode",
      value: "disable",
    });
  });

  it("only accepts a whole number of days to keep chats", () => {
    render(<ConfigView />);
    const days = screen.getByLabelText("Keep chats for (days)");
    fireEvent.input(days, { target: { value: "0" } });
    fireEvent.blur(days);
    fireEvent.input(days, { target: { value: "45" } });
    fireEvent.blur(days);
    const writes = sent.filter(
      (m) => m.type === "setup:setSetting" && m.key === "cleanupPeriodDays",
    );
    expect(writes).toEqual([
      { type: "setup:setSetting", scope: "auto", key: "cleanupPeriodDays", value: 45, quick: true },
    ]);
  });

  it("switches where chats open", () => {
    render(<ConfigView />);
    fireEvent.change(screen.getByLabelText("Open chats in"), { target: { value: "claudePanel" } });
    expect(sent).toContainEqual({ type: "setPref", key: "openChatsIn", value: "claudePanel" });
  });
});

describe("Skills tab", () => {
  it("filters by where a skill comes from, grouped", () => {
    store.setup.value = sampleSetup({
      skills: [
        ...sampleSetup().skills,
        {
          name: "brainstorming",
          description: "Ideas first",
          scope: "plugin",
          plugin: "superpowers@official",
          dir: "/p/brainstorming",
          file: "/p/brainstorming/SKILL.md",
          model: null,
          allowedTools: [],
          userInvocable: true,
          modelInvocable: true,
          problems: [],
          linked: false,
          tags: [],
          argumentHint: null,
          group: null,
          loaded: true,
          command: "/superpowers:brainstorming",
        },
      ],
    });
    render(<SetupPage page="skills" />);
    expect(screen.getByRole("heading", { name: /Plugin: superpowers/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Plugins/ }));
    expect(screen.getByText("brainstorming")).toBeTruthy();
    expect(screen.queryByText("release-notes")).toBeNull();
  });
});

describe("Account", () => {
  const profile = {
    id: "a",
    name: "Ana Ruiz",
    email: "ana@acme.dev",
    organization: "Acme",
    role: "admin",
    plan: "Max 20x",
    since: null,
  };

  it("shows who is signed in, with the plan, and every account action", () => {
    store.account.value = { profile, saved: [], canSwitch: true, switchedAt: null };
    render(<AccountView />);
    expect(screen.getByRole("heading", { name: "Ana Ruiz" })).toBeTruthy();
    expect(screen.getByText("Max 20x")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save this account/ }));
    // The avatar is a switch button too.
    expect(screen.getAllByRole("button", { name: /Switch account/ })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /Switch account/ })[1]!);
    fireEvent.click(screen.getByRole("button", { name: /Log out/ }));
    expect(sent.map((m) => m.type)).toEqual(["account:save", "account:pick", "account:logout"]);
  });

  it("lists saved accounts, marks the one in use, and switches with one click", () => {
    store.account.value = {
      profile,
      saved: [
        {
          id: "a",
          name: "Ana Ruiz",
          email: "ana@acme.dev",
          plan: "Max 20x",
          organization: "Acme",
          savedAt: 1,
        },
        {
          id: "b",
          name: "Ana",
          email: "ana@gmail.com",
          plan: "Pro",
          organization: null,
          savedAt: 1,
        },
      ],
      canSwitch: true,
      switchedAt: null,
    };
    render(<AccountView />);
    expect(screen.queryByRole("button", { name: /Save this account/ })).toBeNull();
    expect(screen.getByText("In use")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to ana@gmail.com" }));
    expect(sent).toContainEqual({ type: "account:switch", id: "b" });
  });

  it("shows how long the sign-in lasts and the plan's colour", () => {
    store.account.value = { profile, saved: [], canSwitch: true, switchedAt: null, signInDays: 12 };
    render(<AccountView />);
    expect(screen.getByText("Signed in for 12 more days")).toBeTruthy();
    expect(screen.getByText("Max 20x").className).toContain("plan-max");
  });

  it("warns when Claude Code's settings file is broken, and offers its backup", () => {
    store.account.value = {
      profile,
      saved: [],
      canSwitch: true,
      switchedAt: null,
      broken: { backup: "/b/x", backupAt: 1 },
    };
    render(<AccountView />);
    expect(screen.getByRole("alert").textContent).toMatch(/settings file looks broken/);
    fireEvent.click(screen.getByRole("button", { name: "Restore from backup" }));
    expect(sent).toContainEqual({ type: "account:restoreConfig" });
  });

  it("offers to log in when signed out", () => {
    store.account.value = { profile: null, saved: [], canSwitch: true, switchedAt: null };
    render(<AccountView />);
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(sent).toContainEqual({ type: "account:login" });
  });
});

describe("Checkpoints", () => {
  it("lists chats with checkpoints and opens one to compare or restore", () => {
    store.checkpoints.value = [{ id: ID, files: 3, versions: 7, bytes: 2048, newest: 1 }];
    render(<CheckpointsView />);
    expect(screen.getByText(/3 files · 7 versions · 2.0 KB/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Fix checkout race/ }));
    expect(sent).toContainEqual({ type: "cp:files", id: ID });
  });

  it("explains what checkpoints are when there are none", () => {
    store.checkpoints.value = [];
    render(<CheckpointsView />);
    expect(screen.getByText(/No checkpoints yet/)).toBeTruthy();
  });

  it("formats sizes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1_900_000)).toBe("1.8 MB");
  });
});

describe("usage at a glance", () => {
  const days = (used: number[]) =>
    used.map((t, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, tokens: t }));

  it("counts the streak up to today, or yesterday when today has nothing yet", () => {
    expect(glance(days([1, 0, 1, 1, 1]), "2026-09-05").streak).toBe(3);
    expect(glance(days([1, 1, 1, 0]), "2026-09-04").streak).toBe(3);
    expect(glance(days([1, 1, 0, 0]), "2026-09-04").streak).toBe(0);
  });

  it("finds the best streak and active days", () => {
    const g = glance(days([1, 1, 1, 1, 0, 1]), "2026-09-06");
    expect(g.best).toBe(4);
    expect(g.active).toBe(5);
    expect(g.of).toBe(6);
  });
});
