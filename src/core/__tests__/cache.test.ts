import { describe, expect, it } from "vitest";
import { MtimeCache } from "../cache";

describe("MtimeCache", () => {
  it("returns a value only while mtime and size match", () => {
    const c = new MtimeCache<string>();
    c.set("/f", 10, 5, "v");
    expect(c.get("/f", 10, 5)).toBe("v");
    expect(c.get("/f", 11, 5)).toBeUndefined();
    expect(c.get("/f", 10, 6)).toBeUndefined();
  });

  it("evicts the least recently used entry beyond capacity", () => {
    const c = new MtimeCache<number>(2);
    c.set("/a", 1, 1, 1);
    c.set("/b", 1, 1, 2);
    c.get("/a", 1, 1);
    c.set("/c", 1, 1, 3);
    expect(c.get("/b", 1, 1)).toBeUndefined();
    expect(c.get("/a", 1, 1)).toBe(1);
    expect(c.get("/c", 1, 1)).toBe(3);
  });
});
