import { describe, expect, it } from "vitest";
import { isSessionId } from "../uuid";

describe("isSessionId", () => {
  it("accepts a real session id", () => {
    expect(isSessionId("0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a")).toBe(true);
  });

  it.each([
    "",
    "x; rm -rf /",
    "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a; calc",
    "0b95bc0d-e0c0-4c77-9ad4",
    " 0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a",
    42,
    null,
  ])("rejects %p", (v) => {
    expect(isSessionId(v)).toBe(false);
  });
});
