// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { MenuLayer } from "../../ui/Menu";
import { parsePairs } from "../McpSection";
import { SetupPage } from "../SetupPage";

const sent: ViewMsg[] = [];

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = sampleSetup();
  store.setupQuery.value = "";
  store.setupDetail.value = null;
});
afterEach(cleanup);

const page = () =>
  render(
    <>
      <SetupPage page="mcp" />
      <MenuLayer />
    </>,
  );

describe("parsePairs", () => {
  const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
  it("reads KEY=value lines, skipping blanks and keeping = in values", () => {
    expect(parsePairs("A=1\n\n B = x=y \r\n", KEY)).toEqual({
      pairs: { A: "1", B: "x=y" },
      bad: [],
    });
  });
  it("names the lines that aren't pairs", () => {
    expect(parsePairs("A=1\nnope\n=2\n1X=3", KEY).bad).toEqual([2, 3, 4]);
  });
});

describe("MCP page", () => {
  it("filters servers by where they're set up", () => {
    page();
    expect(screen.getByText("github")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Project/ }));
    expect(screen.queryByText("github")).toBeNull();
    expect(screen.getByText("postgres")).toBeTruthy();
  });

  it("shows each server's transport and whether its command is installed", () => {
    store.setup.value = { ...sampleSetup(), missingCommands: ["npx"] };
    page();
    expect(screen.getByText("http")).toBeTruthy();
    expect(screen.getByText("stdio")).toBeTruthy();
    expect(screen.getByRole("img", { name: /"npx" wasn't found/ })).toBeTruthy();
  });

  it("warns once about servers that need signing in again", () => {
    store.setup.value = { ...sampleSetup(), mcpNeedsAuth: ["github"] };
    page();
    expect(screen.getByText(/1 server needs signing in again/)).toBeTruthy();
    expect(screen.getByText("Needs sign-in")).toBeTruthy();
  });

  it("offers Claude's own checks from the ⋯ menu", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "More actions for github" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Check its status/ }));
    expect(sent).toContainEqual({ type: "setup:run", what: "mcpGet", name: "github" });
  });

  it("edits a server in place, keeping the secrets it never showed", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "More actions for github" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit/ }));
    expect(screen.getByText(/kept: Authorization/)).toBeTruthy();
    const url = screen.getByLabelText("URL") as HTMLInputElement;
    expect(url.value).toBe("https://api.githubcopilot.com/mcp/");
    fireEvent.input(url, { target: { value: "https://example.com/mcp" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(sent[sent.length - 1]).toMatchObject({
      type: "setup:mcpAdd",
      scope: "user",
      name: "github",
      transport: "http",
      url: "https://example.com/mcp",
      replace: "github",
    });
    expect(sent[sent.length - 1]).not.toHaveProperty("headers");
  });

  it("sends environment variables typed into the form", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    const form = screen.getByText("Add an MCP server").closest(".form") as HTMLElement;
    fireEvent.input(within(form).getByLabelText("Name"), { target: { value: "fs" } });
    fireEvent.input(within(form).getByLabelText("Command"), { target: { value: "npx srv" } });
    fireEvent.input(within(form).getByLabelText(/Environment variables/), {
      target: { value: "TOKEN=abc" },
    });
    fireEvent.click(within(form).getByRole("button", { name: /^Add$/ }));
    expect(sent[sent.length - 1]).toMatchObject({ command: "npx", env: { TOKEN: "abc" } });
  });

  it("explains a bad environment line instead of sending it", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    const form = screen.getByText("Add an MCP server").closest(".form") as HTMLElement;
    fireEvent.input(within(form).getByLabelText("Name"), { target: { value: "fs" } });
    fireEvent.input(within(form).getByLabelText("Command"), { target: { value: "npx srv" } });
    fireEvent.input(within(form).getByLabelText(/Environment variables/), {
      target: { value: "oops" },
    });
    expect(within(form).getByText(/Line 1 of the environment/)).toBeTruthy();
    expect(
      (within(form).getByRole("button", { name: /^Add$/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("turns a project server off and on with its switch", () => {
    const s = sampleSetup();
    s.mcp[1]!.approval = "approved";
    store.setup.value = s;
    page();
    fireEvent.click(screen.getByRole("switch", { name: /postgres on/ }));
    expect(sent).toContainEqual({ type: "setup:mcpApproval", name: "postgres", state: "rejected" });
  });
});

describe("MCP server details", () => {
  it("shows how it connects and what it's given, never saved values", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^postgres/ }));
    const given = screen.getByRole("region", { name: "What it's given" });
    expect(within(given).getByText("DATABASE_URL")).toBeTruthy();
    expect(within(given).getByText(/never shows saved values/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Check status/ }));
    expect(sent).toContainEqual({ type: "setup:run", what: "mcpGet", name: "postgres" });
    fireEvent.click(screen.getByRole("button", { name: "Use it here" }));
    expect(sent).toContainEqual({ type: "setup:mcpApproval", name: "postgres", state: "approved" });
  });

  it("edits from its page", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^github/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Edit github")).toBeTruthy();
  });
});
