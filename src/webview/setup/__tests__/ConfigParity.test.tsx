// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import type { Session } from "../../../features/chats/types";
import { settingsCatalog } from "../../../features/setup/catalog";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { ConfigView } from "../ConfigView";

const sent: ViewMsg[] = [];

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = sampleSetup();
  store.catalog.value = settingsCatalog();
  store.setupQuery.value = "";
  store.sessions.value = [
    { id: "a", lastActiveAt: 2, model: "claude-opus-5-5" } as Session,
    { id: "b", lastActiveAt: 1, model: "claude-sonnet-5-5" } as Session,
  ];
});
afterEach(cleanup);

const quick = (key: string, value: unknown) => ({
  type: "setup:setSetting",
  scope: "auto",
  key,
  value,
  quick: true,
});

describe("Config: model", () => {
  it("names the model Default uses now, from your latest chat", () => {
    const s = sampleSetup();
    s.settings[0]!.values = {};
    store.setup.value = s;
    render(<ConfigView />);
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(model.options[0]!.textContent).toBe("Default (Opus 5.5)");
  });
});

describe("Config: git", () => {
  it("adds nothing to commits, or custom text to pull requests", () => {
    render(<ConfigView />);
    const git = screen.getByRole("region", { name: "Git & attribution" });
    fireEvent.change(within(git).getByLabelText("Commit attribution"), {
      target: { value: "none" },
    });
    expect(sent).toContainEqual(quick("attribution.commit", ""));
    fireEvent.change(within(git).getByLabelText("Pull request attribution"), {
      target: { value: "custom" },
    });
    const text = within(git).getByLabelText("Pull request attribution text");
    fireEvent.input(text, { target: { value: "Made with Claude" } });
    fireEvent.blur(text);
    expect(sent).toContainEqual(quick("attribution.pr", "Made with Claude"));
  });

  it("turns off Claude's built-in git instructions", () => {
    render(<ConfigView />);
    fireEvent.click(screen.getByLabelText(/Built-in git guidance/));
    expect(sent).toContainEqual(quick("includeGitInstructions", false));
  });

  it("offers to remove the old co-authored-by setting", () => {
    const s = sampleSetup();
    s.settings[0]!.values.includeCoAuthoredBy = { value: false };
    store.setup.value = s;
    render(<ConfigView />);
    fireEvent.click(screen.getByRole("button", { name: "Remove the old setting" }));
    expect(sent).toContainEqual({
      type: "setup:setSetting",
      scope: "user",
      key: "includeCoAuthoredBy",
      value: null,
    });
  });
});

describe("Config: interface and actions", () => {
  it("turns on voice dictation and shows the status line", () => {
    const s = sampleSetup();
    s.settings[0]!.values.statusLine = { keys: ["type", "command"] };
    store.setup.value = s;
    render(<ConfigView />);
    fireEvent.click(screen.getByLabelText(/Voice dictation/));
    expect(sent).toContainEqual(quick("voice.enabled", true));
    fireEvent.click(screen.getByRole("button", { name: "Change in /statusline" }));
    expect(sent).toContainEqual({ type: "setup:run", what: "slashStatusline" });
  });

  it("opens the settings file, /config and Orbit's settings, and resets", () => {
    render(<ConfigView />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings.json" }));
    fireEvent.click(screen.getByRole("button", { name: "Open /config" }));
    fireEvent.click(screen.getByRole("button", { name: "Orbit's settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset settings…" }));
    expect(sent).toEqual(
      expect.arrayContaining([
        { type: "setup:open", file: "/Users/ana/.claude/settings.json" },
        { type: "setup:run", what: "slashConfig" },
        { type: "openOrbitSettings" },
        { type: "setup:resetUserSettings" },
      ]),
    );
  });
});

describe("Config: sidebar tabs", () => {
  const env = (prefs: object) => {
    store.env.value = {
      claudeExtension: true,
      hasWorkspace: true,
      platform: "linux",
      prefs: { openChatsIn: "terminal", terminalLocation: "editor", ...prefs },
    };
  };

  it("hides a tab and shows it again", () => {
    env({ hiddenTabs: ["memory"] });
    render(<ConfigView />);
    const tabs = screen.getByRole("region", { name: "Sidebar tabs" });
    fireEvent.click(within(tabs).getByLabelText("Show Usage"));
    expect(sent).toContainEqual({ type: "setPref", key: "hiddenTabs", value: ["memory", "usage"] });
    fireEvent.click(within(tabs).getByLabelText("Show Memory"));
    expect(sent).toContainEqual({ type: "setPref", key: "hiddenTabs", value: [] });
    expect((within(tabs).getByLabelText("Show Config") as HTMLInputElement).disabled).toBe(true);
  });

  it("moves a tab up or down", () => {
    env({});
    render(<ConfigView />);
    const tabs = screen.getByRole("region", { name: "Sidebar tabs" });
    fireEvent.click(within(tabs).getByRole("button", { name: "Move Chats up" }));
    const last = sent[sent.length - 1] as { key: string; value: string[] };
    expect(last.key).toBe("tabOrder");
    expect(last.value.slice(0, 2)).toEqual(["chats", "home"]);
  });
});

describe("Config: undo history", () => {
  it("asks for the history and lists changes and trash, newest first, with Undo and Restore", async () => {
    store.history.value = null;
    store.openSections.value = ["history"];
    render(<ConfigView />);
    expect(sent).toContainEqual({ type: "history:list" });
    store.applyHostMessage({
      type: "history",
      edits: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          label: "Effort level: high",
          file: "/u/.claude/settings.json",
          at: 2,
        },
      ],
      trash: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          label: "Deleted skill notes",
          original: "/u/.claude/skills/notes",
          at: 3,
        },
      ],
    });
    const hist = await screen.findByRole("group", { name: /Undo history/ });
    const titles = within(hist)
      .getAllByText(/Effort level: high|Deleted skill notes/)
      .map((e) => e.textContent);
    expect(titles).toEqual(["Deleted skill notes", "Effort level: high"]);
    fireEvent.click(within(hist).getByRole("button", { name: "Undo" }));
    fireEvent.click(within(hist).getByRole("button", { name: "Restore" }));
    expect(sent).toContainEqual({
      type: "history:undo",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(sent).toContainEqual({
      type: "history:restore",
      id: "22222222-2222-4222-8222-222222222222",
    });
  });
});

describe("Config: backup and help", () => {
  it("backs up, brings in, checks health and reports a problem", () => {
    render(<ConfigView />);
    const g = screen.getByRole("region", { name: "Backup & help" });
    for (const name of ["Back up…", "Bring in a backup…", "Check health", "Report a problem…"])
      fireEvent.click(within(g).getByRole("button", { name }));
    expect(sent).toEqual(
      expect.arrayContaining([
        { type: "orbitCommand", id: "exportBrain" },
        { type: "orbitCommand", id: "importBrain" },
        { type: "orbitCommand", id: "runDiagnostics" },
        { type: "orbitCommand", id: "reportProblem" },
      ]),
    );
  });
});
