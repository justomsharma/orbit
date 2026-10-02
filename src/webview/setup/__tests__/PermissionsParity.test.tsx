// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { PermissionsSection } from "../PermissionsSection";

const sent: ViewMsg[] = [];

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  const s = sampleSetup();
  s.permissions.rules = Array.from({ length: 9 }, (_, i) => ({
    scope: "user" as const,
    list: "allow" as const,
    rule: `Bash(task-${i} *)`,
  }));
  s.permissions.additionalDirectories = [{ scope: "user", dir: "/Users/ana/shared-lib" }];
  store.setup.value = s;
  store.setupQuery.value = "";
  store.openSections.value = ["permissions"];
});
afterEach(cleanup);

describe("Permissions", () => {
  it("shows six rules per list, then the rest on request", async () => {
    render(<PermissionsSection />);
    expect(screen.queryByText("Bash(task-8 *)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(await screen.findByText("Bash(task-8 *)")).toBeTruthy();
  });

  it("fills in a common rule, including one per MCP server", () => {
    render(<PermissionsSection />);
    const common = screen.getByLabelText("Common rules") as HTMLSelectElement;
    expect([...common.options].map((o) => o.value)).toContain("mcp__github");
    fireEvent.change(common, { target: { value: "Bash(git diff *)" } });
    expect((screen.getByLabelText("New rule") as HTMLInputElement).value).toBe("Bash(git diff *)");
  });

  it("lists extra folders Claude may use, adds and removes them", async () => {
    render(<PermissionsSection />);
    const dirs = screen.getByRole("region", { name: "Other folders Claude may use" });
    expect(within(dirs).getByText("/Users/ana/shared-lib")).toBeTruthy();
    fireEvent.click(within(dirs).getByRole("button", { name: "Remove /Users/ana/shared-lib" }));
    fireEvent.click(within(dirs).getByRole("button", { name: "Add a folder…" }));
    await waitFor(() =>
      expect(sent).toEqual([
        { type: "setup:dir", op: "remove", scope: "user", dir: "/Users/ana/shared-lib" },
        { type: "setup:dir", op: "add", scope: "user" },
      ]),
    );
  });
});
