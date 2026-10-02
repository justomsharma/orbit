// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import { HOOK_EVENTS, HOOK_INFO, hookTitle } from "../../../features/setup/hookEvents";
import type { HookEntry } from "../../../features/setup/hooks";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { SetupPage } from "../SetupPage";

const sent: ViewMsg[] = [];
const home = "/Users/ana/.claude";
const hook = (over: Partial<HookEntry>): HookEntry => ({
  ...sampleSetup().hooks[0]!,
  ...over,
});

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = {
    ...sampleSetup(),
    hooks: [
      hook({}),
      hook({
        id: `user:${home}/settings.json:PreToolUse:0:0`,
        event: "PreToolUse",
        matcher: "Bash",
        command: "node ~/hooks/guard-bash.mjs --strict",
        timeout: 5,
      }),
    ],
    pausedHooks: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        scope: "user",
        source: `${home}/settings.json`,
        event: "SessionStart",
        matcher: null,
        type: "command",
        command: "~/bin/hello.sh",
        url: null,
        timeout: null,
        at: 1,
      },
    ],
  };
  store.setupQuery.value = "";
  store.setupDetail.value = null;
});
afterEach(cleanup);

const page = () => render(<SetupPage page="hooks" />);

describe("hook names", () => {
  it("explains every event Claude has", () => {
    for (const e of HOOK_EVENTS) expect(HOOK_INFO[e]?.title).toBeTruthy();
  });

  it("names a hook after the script it runs", () => {
    expect(hookTitle("node ~/hooks/guard-bash.mjs --strict", null)).toBe("guard-bash.mjs");
    expect(hookTitle('"C:\\tools\\notify.cmd" done', null)).toBe("notify.cmd");
    expect(hookTitle("prettier --write", null)).toBe("prettier");
    expect(hookTitle(null, "https://hooks.example.com/claude")).toBe("hooks.example.com");
  });
});

describe("Hooks list", () => {
  it("groups by what triggers them, in plain words, with the tool they watch", () => {
    page();
    expect(screen.getByRole("heading", { name: /Before a tool runs/ })).toBeTruthy();
    const row = screen.getByRole("button", { name: /^guard-bash\.mjs/ });
    expect(within(row).getByText("Bash")).toBeTruthy();
  });

  it("pauses one hook and resumes a paused one", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Pause guard-bash.mjs" }));
    expect(sent).toContainEqual({
      type: "setup:hookPause",
      id: `user:${home}/settings.json:PreToolUse:0:0`,
    });
    expect(screen.getByText("Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume hello.sh" }));
    expect(sent).toContainEqual({
      type: "setup:hookResume",
      id: "11111111-1111-4111-8111-111111111111",
    });
  });
});

describe("Hook details", () => {
  const open = () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^guard-bash\.mjs/ }));
  };

  it("says what it runs, when, for which tools, and how long it may take", () => {
    open();
    const info = screen.getByRole("region", { name: "About this hook" });
    expect(within(info).getByText(/Before Claude uses a tool/)).toBeTruthy();
    expect(within(info).getByText("Bash")).toBeTruthy();
    expect(within(info).getByText("5 seconds")).toBeTruthy();
    expect(within(info).getByText("node ~/hooks/guard-bash.mjs --strict")).toBeTruthy();
  });

  it("opens Claude's /hooks and the settings file", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Open /hooks" }));
    fireEvent.click(screen.getByRole("button", { name: "Open settings file" }));
    expect(sent).toContainEqual({ type: "setup:run", what: "slashHooks" });
    expect(sent).toContainEqual({ type: "setup:open", file: `${home}/settings.json` });
  });

  it("edits it, also moving it to another settings file", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit hook" });
    fireEvent.input(within(form).getByLabelText("Run"), { target: { value: "guard.sh" } });
    fireEvent.input(within(form).getByLabelText(/Time limit/), { target: { value: "" } });
    fireEvent.change(within(form).getByLabelText(/Saved in/), { target: { value: "project" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(sent[sent.length - 1]).toMatchObject({
      type: "setup:hookEdit",
      id: `user:${home}/settings.json:PreToolUse:0:0`,
      scope: "project",
      event: "PreToolUse",
      matcher: "Bash",
      command: "guard.sh",
      timeout: null,
    });
  });

  it("keeps the matcher of a hook on a non-tool event when editing it", () => {
    store.setup.value = {
      ...sampleSetup(),
      pausedHooks: [],
      hooks: [
        hook({
          id: `user:${home}/settings.json:SessionStart:0:0`,
          event: "SessionStart",
          matcher: "compact",
          command: "~/bin/after-compact.sh",
        }),
      ],
    };
    page();
    fireEvent.click(screen.getByRole("button", { name: /^after-compact\.sh/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit hook" });
    expect((within(form).getByLabelText(/Only when/) as HTMLInputElement).value).toBe("compact");
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(sent[sent.length - 1]).toMatchObject({ event: "SessionStart", matcher: "compact" });
  });

  it("removes it", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    await waitFor(() =>
      expect(sent).toContainEqual({
        type: "setup:hookRemove",
        id: `user:${home}/settings.json:PreToolUse:0:0`,
      }),
    );
  });
});
