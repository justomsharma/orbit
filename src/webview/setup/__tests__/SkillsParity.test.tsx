// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { SetupPage } from "../SetupPage";

const sent: ViewMsg[] = [];
const writeText = vi.fn(async () => {});

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = sampleSetup();
  store.setupQuery.value = "";
  store.skillScope.value = "all";
  store.setupDetail.value = null;
  store.setupContent.value = null;
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockClear();
});
afterEach(cleanup);

const page = () => render(<SetupPage page="skills" />);
const file = () => sampleSetup().skills[0]!.file;

describe("Skills list", () => {
  it("shows tags and starts a chat with the skill typed in", () => {
    page();
    expect(screen.getByText("docs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use /release-notes in a new chat" }));
    expect(sent).toContainEqual({ type: "setup:launch", file: file() });
  });

  it("copies what you type to run it", async () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Copy /release-notes" }));
    expect(writeText).toHaveBeenCalledWith("/release-notes");
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("finds skills by tag", async () => {
    page();
    store.setupQuery.value = "docs";
    await waitFor(() => expect(screen.queryByText("deploy")).toBeNull());
    expect(screen.getByText("release-notes")).toBeTruthy();
  });
});

describe("Skill details", () => {
  const open = () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^release-notes/ }));
  };

  it("opens from its name and asks for the file's text", () => {
    open();
    expect(screen.getByRole("heading", { name: "release-notes" })).toBeTruthy();
    expect(sent).toContainEqual({ type: "setup:read", file: file() });
  });

  it("explains how to use it and what it may do", () => {
    open();
    const info = screen.getByRole("region", { name: "About this skill" });
    expect(within(info).getByText("/release-notes <version>")).toBeTruthy();
    expect(within(info).getByText("Bash(git log *)")).toBeTruthy();
    expect(within(info).getByText("This project")).toBeTruthy();
  });

  it("shows the file once it arrives", async () => {
    open();
    store.applyHostMessage({
      type: "setup:content",
      file: file(),
      text: "---\nname: release-notes\n---\nRead the merged PRs.",
      truncated: false,
    });
    expect(await screen.findByText(/Read the merged PRs\./)).toBeTruthy();
  });

  it("says when the file is too large to show", async () => {
    open();
    store.applyHostMessage({ type: "setup:content", file: file(), text: null, truncated: true });
    expect(await screen.findByText(/too large to show here/)).toBeTruthy();
  });

  it("uses, opens and deletes it from the page", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Use in chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(sent).toEqual(
      expect.arrayContaining([
        { type: "setup:launch", file: file() },
        { type: "setup:open", file: file() },
        { type: "setup:trash", file: file() },
      ]),
    );
  });

  it("goes back to the list", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "All skills" }));
    expect(screen.getByRole("button", { name: /^deploy/ })).toBeTruthy();
  });

  it("says so if the skill is no longer there", async () => {
    open();
    store.setup.value = { ...sampleSetup(), skills: [] };
    expect(await screen.findByText(/isn't there any more/)).toBeTruthy();
  });

  it("can't be deleted or hidden when a plugin owns it", () => {
    store.setup.value = {
      ...sampleSetup(),
      skills: [{ ...sampleSetup().skills[0]!, scope: "plugin", plugin: "tools@market" }],
    };
    open();
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
  });

  it("warns that a nested skill isn't loaded and offers no Use", () => {
    store.setup.value = {
      ...sampleSetup(),
      skills: [
        {
          ...sampleSetup().skills[0]!,
          group: "team",
          loaded: false,
          problems: ["Claude Code only loads skills one folder below skills/."],
        },
      ],
    };
    open();
    expect(screen.getByText(/only loads skills one folder below/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Use in chat" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
