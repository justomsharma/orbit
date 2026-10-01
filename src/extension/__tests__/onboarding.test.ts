import { describe, expect, it } from "vitest";
import { stepFor } from "../onboarding";

const ID = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";

describe("stepFor: what a person just did, as a getting-started step", () => {
  it.each([
    [{ type: "openChat", id: ID }, "continue"],
    [{ type: "openTerminal", id: ID }, "continue"],
    [{ type: "forkChat", id: ID }, "continue"],
    [{ type: "chat:details", id: ID }, "details"],
    [{ type: "tab", tab: "setup" }, "setup"],
    [{ type: "quota", on: true }, "limits"],
    [{ type: "onboarding", action: "find" }, "find"],
  ])("%o → %s", (msg, step) => {
    expect(stepFor(msg)).toBe(step);
  });

  it("ignores everything else, including invalid messages", () => {
    expect(stepFor({ type: "tab", tab: "usage" })).toBeNull();
    expect(stepFor({ type: "quota", on: false })).toBeNull();
    expect(stepFor({ type: "openChat", id: "not-a-uuid" })).toBeNull();
    expect(stepFor({ type: "onboarding", action: "dismiss" })).toBeNull();
    expect(stepFor("junk")).toBeNull();
  });
});
