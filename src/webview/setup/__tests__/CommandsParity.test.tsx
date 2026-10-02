// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import { BUILTIN_COMMANDS } from "../../../features/setup/builtinCommands";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { SetupPage } from "../SetupPage";

const sent: ViewMsg[] = [];
const ship = () => sampleSetup().commands[0]!.file;

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = sampleSetup();
  store.setupQuery.value = "";
  store.setupDetail.value = null;
  store.setupContent.value = null;
  store.commandScope.value = "all";
});
afterEach(cleanup);

const page = () => render(<SetupPage page="commands" />);

describe("built-in catalogue", () => {
  it("has Claude Code's own commands, each once, with a plain description", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["compact", "clear", "model", "mcp", "hooks", "init", "code-review", "context"])
      expect(names).toContain(n);
    for (const c of BUILTIN_COMMANDS) expect(c.description.length).toBeGreaterThan(5);
  });
});

describe("Commands list", () => {
  it("shows built-in and your commands, filterable, with counts", async () => {
    page();
    const filter = screen.getByRole("group", { name: "Show commands" });
    expect(filter.textContent).toContain(`Built-in${BUILTIN_COMMANDS.length}`);
    expect(screen.getByText("/ship")).toBeTruthy();
    expect(screen.getByText("/compact")).toBeTruthy();
    fireEvent.click(within(filter).getByRole("radio", { name: /Project/ }));
    await waitFor(() => expect(screen.queryByText("/compact")).toBeNull());
    expect(screen.getByText("/ship")).toBeTruthy();
  });

  it("starts a chat with a built-in command typed in", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Use /compact in a new chat" }));
    expect(sent).toContainEqual({ type: "setup:launchBuiltin", name: "compact" });
  });

  it("starts a chat with your own command typed in", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Use /ship in a new chat" }));
    expect(sent).toContainEqual({ type: "setup:launch", file: ship() });
  });
});

describe("Command details", () => {
  it("shows a built-in command with a link to Claude's docs", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^\/compact/ }));
    expect(screen.getByRole("heading", { name: "/compact" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Read the docs/ }));
    expect(sent).toContainEqual({ type: "openOrbitLink", link: "commandsDocs" });
  });

  it("shows your command's file, and opens or deletes it", async () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^\/ship/ }));
    expect(screen.getByText("/ship [version]")).toBeTruthy();
    expect(sent).toContainEqual({ type: "setup:read", file: ship() });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(sent).toContainEqual({ type: "setup:open", file: ship() });
    expect(sent).toContainEqual({ type: "setup:trash", file: ship() });
  });
});
