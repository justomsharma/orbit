// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleUsage } from "../../../../test/helpers/usageFixture";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { dayTip } from "../../ui/charts/YearMap";
import { modelColor, UsageView } from "../UsageView";

const sent: ViewMsg[] = [];

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.usage.value = sampleUsage();
  store.range.value = "month";
  store.usageShut.value = [];
});
afterEach(cleanup);

describe("Usage", () => {
  it("shows tokens, chats, replies and cache read, with what each means", () => {
    render(<UsageView />);
    for (const label of ["Tokens", "Chats", "Replies", "Cache read"])
      expect(screen.getByText(label)).toBeTruthy();
  });

  it("splits cost by model in one bar with a legend of cost and share", () => {
    render(<UsageView />);
    const block = screen.getByRole("region", { name: "Cost & models" });
    expect(
      within(block).getByRole("img", { name: /Tokens by model: Opus 5\.5 80%, Sonnet 5\.5 20%/ }),
    ).toBeTruthy();
    expect(within(block).getByText(/\$75\.20 · 80%/)).toBeTruthy();
    expect(within(block).getByText(/Prices as of/)).toBeTruthy();
  });

  it("opens and closes each section, remembering it", () => {
    render(<UsageView />);
    const toggle = screen.getByRole("button", { name: /Tools Claude used/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(store.usageShut.value).toContain("tools");
    expect(screen.queryByText("Read")).toBeNull();
  });

  it("shows MCP servers with their calls and tools", () => {
    render(<UsageView />);
    const mcp = screen.getByRole("region", { name: "MCP servers" });
    expect(within(mcp).getByText("github")).toBeTruthy();
    expect(within(mcp).getByText("90 calls")).toBeTruthy();
    expect(within(mcp).getByText("4 tools")).toBeTruthy();
  });

  it("maps the last year, Monday first, ending today", () => {
    render(<UsageView />);
    const map = screen.getByRole("img", { name: /Activity over the last year/ });
    expect(map.querySelectorAll("rect.today")).toHaveLength(1);
  });

  it("explains each day in plain words", () => {
    expect(dayTip({ day: "2026-03-03", tokens: 12_300, messages: 4, sessions: 2 })).toMatch(
      /^12\.3K tokens · 4 replies · 2 chats · Tue/,
    );
    expect(dayTip({ day: "2026-03-03", tokens: 0, messages: 0, sessions: 0 })).toMatch(
      /^No activity/,
    );
  });

  it("says how long the longest chat ran", () => {
    render(<UsageView />);
    expect(screen.getByText(/Longest chat: 5h 12m in the last 30 days/)).toBeTruthy();
  });

  it("colours models by family", () => {
    expect(modelColor("claude-opus-5-5")).toMatch(/^hsl\(220 /);
    expect(modelColor("claude-sonnet-5-5")).toMatch(/^hsl\(32 /);
    expect(modelColor("claude-haiku-4-5")).toMatch(/^hsl\(155 /);
    expect(modelColor("something")).toBe("hsl(220 8% 55%)");
  });
});
