import { describe, expect, it } from "vitest";
import { arrangeTabs, TAB_IDS } from "../tabs";

const ids = (o?: string[], h?: string[]) => arrangeTabs(o, h).map((t) => t.id);

describe("arrangeTabs", () => {
  it("keeps Orbit's order when nothing is set", () => {
    expect(ids()).toEqual(TAB_IDS);
  });

  it("puts tabs in your order, adding any it doesn't name in their usual place after", () => {
    const out = ids(["usage", "chats", "nope", "usage"]);
    expect(out.slice(0, 2)).toEqual(["usage", "chats"]);
    expect(out).toHaveLength(TAB_IDS.length);
    expect(new Set(out).size).toBe(TAB_IDS.length);
    expect(out[2]).toBe("home");
  });

  it("hides tabs, but never Config, so the setting can always be changed back", () => {
    const out = ids(undefined, ["usage", "config", "memory"]);
    expect(out).not.toContain("usage");
    expect(out).not.toContain("memory");
    expect(out).toContain("config");
  });
});
