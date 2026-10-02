// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import type { AgentInfo } from "../../../features/setup/agents";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { modelFamily } from "../ContentSections";
import { SetupPage } from "../SetupPage";

const sent: ViewMsg[] = [];
const agent = (over: Partial<AgentInfo>): AgentInfo => ({
  ...sampleSetup().agents[0]!,
  ...over,
});

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = {
    ...sampleSetup(),
    agents: [
      agent({}),
      agent({
        name: "tester",
        model: null,
        tools: ["Bash", "Read", "Grep", "Glob", "Edit", "Write"],
        file: "/home/ana/.claude/agents/tester.md",
        description: null,
        problems: ["No description — Claude won't know when to use it"],
      }),
      agent({ name: "planner", model: "opus", file: "/home/ana/.claude/agents/planner.md" }),
    ],
  };
  store.setupQuery.value = "";
  store.setupDetail.value = null;
  store.setupContent.value = null;
  store.agentModel.value = "all";
});
afterEach(cleanup);

const page = () => render(<SetupPage page="agents" />);
const reviewer = () => sampleSetup().agents[0]!.file;

describe("modelFamily", () => {
  it("groups model names the way you pick them", () => {
    expect(modelFamily(null)).toBe("inherit");
    expect(modelFamily("inherit")).toBe("inherit");
    expect(modelFamily("claude-sonnet-5-5")).toBe("sonnet");
    expect(modelFamily("opus")).toBe("opus");
    expect(modelFamily("my-model")).toBe("custom");
  });
});

describe("Agents list", () => {
  it("filters by model, with counts", async () => {
    page();
    const pick = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual([
      "All models (3)",
      "Sonnet (1)",
      "Opus (1)",
      "Same as the chat (1)",
    ]);
    fireEvent.change(pick, { target: { value: "opus" } });
    await waitFor(() => expect(screen.queryByText("reviewer")).toBeNull());
    expect(screen.getByText("planner")).toBeTruthy();
  });

  it("shows up to four tools and how many more, and flags a missing description", () => {
    page();
    const row = screen.getByRole("button", { name: /^tester/ });
    expect(within(row).getByText("Bash")).toBeTruthy();
    expect(within(row).getByText("+2")).toBeTruthy();
    expect(within(row).getByRole("img", { name: /Needs a look/ })).toBeTruthy();
  });
});

describe("Agent details", () => {
  const open = () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^reviewer/ }));
  };

  it("shows its model, tools and system prompt without the frontmatter", async () => {
    open();
    const info = screen.getByRole("region", { name: "About this agent" });
    expect(within(info).getByText("Read")).toBeTruthy();
    store.applyHostMessage({
      type: "setup:content",
      file: reviewer(),
      text: "---\nname: reviewer\n---\nYou review diffs.\n",
      truncated: false,
    });
    const prompt = await screen.findByRole("region", { name: "System prompt" });
    expect(prompt.textContent).toContain("You review diffs.");
    expect(prompt.textContent).not.toContain("name: reviewer");
  });

  it("duplicates and deletes it", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(sent).toContainEqual({ type: "setup:agentDuplicate", file: reviewer() });
    expect(sent).toContainEqual({ type: "setup:trash", file: reviewer() });
  });

  it("edits every field and sends them together", async () => {
    open();
    store.applyHostMessage({
      type: "setup:content",
      file: reviewer(),
      text: "---\nname: reviewer\n---\nYou review diffs.\n",
      truncated: false,
    });
    const edit = screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement;
    await waitFor(() => expect(edit.disabled).toBe(false));
    fireEvent.click(edit);
    const form = await screen.findByRole("form", { name: "Edit reviewer" });
    expect((within(form).getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe(
      "You review diffs.\n",
    );
    fireEvent.change(within(form).getByLabelText("Model"), { target: { value: "haiku" } });
    fireEvent.input(within(form).getByLabelText(/Tools/), {
      target: { value: "Read, Bash(git *)" },
    });
    fireEvent.input(within(form).getByLabelText(/Skills/), { target: { value: "release-notes" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(sent[sent.length - 1]).toMatchObject({
      type: "setup:agentSave",
      file: reviewer(),
      name: "reviewer",
      model: "haiku",
      tools: ["Read", "Bash(git *)"],
      skills: ["release-notes"],
      prompt: "You review diffs.\n",
    });
  });

  it("takes a custom model id", async () => {
    open();
    store.applyHostMessage({
      type: "setup:content",
      file: reviewer(),
      text: "x",
      truncated: false,
    });
    const edit = screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement;
    await waitFor(() => expect(edit.disabled).toBe(false));
    fireEvent.click(edit);
    const form = await screen.findByRole("form", { name: "Edit reviewer" });
    fireEvent.change(within(form).getByLabelText("Model"), { target: { value: "custom" } });
    fireEvent.input(within(form).getByLabelText("Model id"), {
      target: { value: "claude-opus-5-5" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(sent[sent.length - 1]).toMatchObject({ model: "claude-opus-5-5" });
  });
});

describe("New agent", () => {
  it("creates one from the full form", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    const form = screen.getByRole("form", { name: "New agent" });
    fireEvent.input(within(form).getByLabelText("Name"), { target: { value: "docs-writer" } });
    fireEvent.input(within(form).getByLabelText("Description"), {
      target: { value: "Writes docs" },
    });
    fireEvent.input(within(form).getByLabelText("System prompt"), {
      target: { value: "You write docs." },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Create" }));
    expect(sent[sent.length - 1]).toMatchObject({
      type: "setup:agentSave",
      scope: "user",
      name: "docs-writer",
      description: "Writes docs",
      model: null,
      tools: [],
      prompt: "You write docs.",
    });
  });
});
