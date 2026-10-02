// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { SetupPage } from "../SetupPage";

const sent: ViewMsg[] = [];
const dir = "/Users/ana/.claude/projects/-Users-ana-code-shop/memory";

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = sampleSetup();
  store.setupQuery.value = "";
  store.setupDetail.value = null;
  store.setupContent.value = null;
  store.memoryLens.value = "all";
  store.memoryProject.value = "";
  store.memoryOther.value = null;
});
afterEach(cleanup);

const page = () => render(<SetupPage page="memory" />);

describe("Memory list", () => {
  it("shows each memory's type and what needs a look", () => {
    page();
    const testing = screen.getByRole("button", { name: /^testing/ });
    expect(within(testing).getByText("feedback")).toBeTruthy();
    expect(within(testing).getByText("1 broken link")).toBeTruthy();
    const scratch = screen.getByRole("button", { name: /^scratch/ });
    expect(within(scratch).getByText("Unlinked")).toBeTruthy();
    expect(within(scratch).getByText("No frontmatter")).toBeTruthy();
  });

  it("narrows to unlinked or broken memories", async () => {
    page();
    fireEvent.click(screen.getByRole("radio", { name: /Broken/ }));
    await waitFor(() => expect(screen.queryByText("scratch")).toBeNull());
    expect(screen.getByText("testing")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Unlinked/ }));
    await waitFor(() => expect(screen.queryByText("testing")).toBeNull());
    expect(screen.getByText("scratch")).toBeTruthy();
  });

  it("shows another project's memories", async () => {
    page();
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: "-Users-ana-code-api" },
    });
    expect(sent).toContainEqual({ type: "setup:memoryOf", slug: "-Users-ana-code-api" });
    store.applyHostMessage({
      type: "setup:memoryFiles",
      slug: "-Users-ana-code-api",
      files: [
        {
          ...sampleSetup().memory.auto.files[0]!,
          name: "api.md",
          title: "api-notes",
          path: "/m/api.md",
        },
      ],
    });
    expect(await screen.findByText("api-notes")).toBeTruthy();
    expect(screen.queryByText("testing")).toBeNull();
  });

  it("says so when auto memory is off", () => {
    const s = sampleSetup();
    s.settings[0]!.values.autoMemoryEnabled = { value: false };
    store.setup.value = s;
    page();
    expect(screen.getByText(/Auto memory is off/)).toBeTruthy();
  });
});

describe("Memory details", () => {
  const open = () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^testing/ }));
  };

  it("shows its links both ways and jumps between memories", () => {
    open();
    const out = screen.getByRole("region", { name: "Links to" });
    expect(within(out).getByText(/release-flow/)).toBeTruthy();
    expect(within(out).getByText(/not found/)).toBeTruthy();
    const inbound = screen.getByRole("region", { name: "Linked from" });
    fireEvent.click(within(inbound).getByRole("button", { name: "user-role" }));
    expect(screen.getByRole("heading", { name: "user-role" })).toBeTruthy();
    expect(screen.getByText("- [User role](user-role.md) — who Ana is")).toBeTruthy();
  });

  it("opens, shows in its folder and deletes", () => {
    open();
    const file = `${dir}/testing.md`;
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(sent).toContainEqual({ type: "setup:open", file });
    expect(sent).toContainEqual({ type: "setup:revealFile", file });
    expect(sent).toContainEqual({ type: "setup:trash", file });
    expect(sent).toContainEqual({ type: "setup:read", file });
  });
});
