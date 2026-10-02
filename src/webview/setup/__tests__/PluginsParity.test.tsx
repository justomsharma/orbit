// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { MenuLayer } from "../../ui/Menu";
import { SetupPage } from "../SetupPage";

const sent: ViewMsg[] = [];
const SP = "superpowers@claude-plugins-official";

function withChain() {
  const s = sampleSetup();
  s.settings[0]!.values.enabledPlugins = { entries: { [SP]: false } };
  s.settings[1]!.values.enabledPlugins = { entries: { [SP]: true } };
  s.plugins.push({
    ...s.plugins[0]!,
    id: "mystery@somewhere",
    name: "mystery",
    marketplace: "somewhere",
    installPath: "",
    enabled: true,
    problem: "Enabled but not installed",
  });
  return s;
}

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = withChain();
  store.setupQuery.value = "";
  store.setupDetail.value = null;
  store.pluginView.value = "all";
});
afterEach(cleanup);

const page = () =>
  render(
    <>
      <SetupPage page="plugins" />
      <MenuLayer />
    </>,
  );

describe("Plugins list", () => {
  it("says which settings file decides each plugin, and the whole chain", () => {
    page();
    const row = screen.getByRole("button", { name: /^superpowers/ });
    expect(within(row).getByText(/Decided by your project's settings/)).toBeTruthy();
    expect(within(row).getByText("Project: on")).toBeTruthy();
    expect(within(row).getByText("You: off")).toBeTruthy();
  });

  it("lists problems under Issues, with an unknown source flagged", async () => {
    page();
    fireEvent.click(screen.getByRole("radio", { name: /Issues/ }));
    await waitFor(() => expect(screen.queryByText("superpowers")).toBeNull());
    expect(screen.getByText("mystery")).toBeTruthy();
    expect(screen.getByText("Not installed")).toBeTruthy();
    expect(screen.getByText("Unknown source")).toBeTruthy();
  });

  it("shows marketplaces and the organisation's rules under Sources", async () => {
    const s = withChain();
    s.settings[3]!.exists = true;
    s.settings[3]!.values.strictKnownMarketplaces = { keys: ["0"] };
    store.setup.value = s;
    page();
    fireEvent.click(screen.getByRole("radio", { name: /Sources/ }));
    const src = await screen.findByRole("region", { name: "Marketplaces" });
    expect(within(src).getByText("claude-plugins-official")).toBeTruthy();
    expect(within(src).getByText("Official")).toBeTruthy();
    const rules = screen.getByRole("region", { name: "Your organisation's plugin rules" });
    expect(within(rules).getByText("strictKnownMarketplaces")).toBeTruthy();
  });

  it("turns a plugin on in one chosen settings file from its menu", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "More actions for frontend-design" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Turn on for this project/ }));
    expect(sent).toContainEqual({
      type: "setup:plugin",
      id: "frontend-design@claude-plugins-official",
      enabled: true,
      scope: "project",
    });
  });
});

describe("Plugin details", () => {
  it("opens its folder and explains what it contains", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^superpowers/ }));
    const info = screen.getByRole("region", { name: "What's inside" });
    expect(within(info).getByText("14 skills")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    expect(sent).toContainEqual({ type: "setup:revealPlugin", id: SP });
  });

  it("turns it off where it takes effect", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^superpowers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(sent).toContainEqual({ type: "setup:plugin", id: SP, enabled: false, scope: "auto" });
  });
});
