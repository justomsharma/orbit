import { describe, expect, it } from "vitest";
import { type Memento, OrbitState } from "../state";

const A = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const B = "11111111-2222-4333-8444-555555555555";

function memento(): Memento {
  const data = new Map<string, unknown>();
  return {
    get: <T>(k: string, d: T) => (data.has(k) ? (data.get(k) as T) : d),
    update: async (k: string, v: unknown) => {
      data.set(k, v);
    },
  };
}

describe("OrbitState", () => {
  it("pins and unpins chats", async () => {
    const s = new OrbitState(memento());
    await s.setPin(A, true);
    await s.setPin(B, true);
    await s.setPin(A, false);
    expect(s.pins()).toEqual([B]);
  });

  it("does not duplicate a pin", async () => {
    const s = new OrbitState(memento());
    await s.setPin(A, true);
    await s.setPin(A, true);
    expect(s.pins()).toEqual([A]);
  });

  it("renames, trims, and clears with an empty title", async () => {
    const s = new OrbitState(memento());
    await s.setRename(A, "  Checkout rewrite  ");
    expect(s.renames()).toEqual({ [A]: "Checkout rewrite" });
    await s.setRename(A, "   ");
    expect(s.renames()).toEqual({});
  });

  it("ignores invalid ids", async () => {
    const s = new OrbitState(memento());
    await s.setPin("nope", true);
    await s.setRename("nope", "x");
    expect(s.pins()).toEqual([]);
    expect(s.renames()).toEqual({});
  });

  it("survives corrupt stored values", () => {
    const m = memento();
    void m.update("orbit.pins", "garbage");
    void m.update("orbit.renames", ["x"]);
    const s = new OrbitState(m);
    expect(s.pins()).toEqual([]);
    expect(s.renames()).toEqual({});
  });

  it("persists across instances sharing storage", async () => {
    const m = memento();
    await new OrbitState(m).setPin(A, true);
    expect(new OrbitState(m).pins()).toEqual([A]);
  });

  it("keeps tags clean: lowercase words, no repeats, at most 8", async () => {
    const s = new OrbitState(memento());
    await s.setTags(A, [
      "Bug",
      " bug ",
      "#release",
      "big refactor",
      "x".repeat(40),
      "",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
    expect(s.tags()[A]).toEqual([
      "bug",
      "release",
      "big-refactor",
      "x".repeat(24),
      "a",
      "b",
      "c",
      "d",
    ]);
    await s.setTags(A, []);
    expect(s.tags()).toEqual({});
  });

  it("ignores tags for bad ids and tolerates damaged storage", async () => {
    const m = memento();
    await m.update("orbit.tags", { [A]: ["ok", 3], nope: ["x"], [B]: "bad" });
    const s = new OrbitState(m);
    expect(s.tags()).toEqual({ [A]: ["ok"] });
    await s.setTags("not-a-uuid", ["x"]);
    expect(Object.keys(s.tags())).toEqual([A]);
  });

  it("remembers getting-started progress, each step once, and hiding it", async () => {
    const s = new OrbitState(memento());
    expect(s.onboarding()).toEqual({ done: [], dismissed: false, welcomed: false });
    expect(await s.markStep("details")).toBe(true);
    expect(await s.markStep("details")).toBe(false);
    await s.markStep("continue");
    await s.dismissOnboarding();
    expect(s.onboarding()).toEqual({
      done: ["details", "continue"],
      dismissed: true,
      welcomed: false,
    });
  });

  it("ignores unknown steps and damaged storage", async () => {
    const m = memento();
    await m.update("orbit.onboarding", { done: ["setup", "nope", 3], dismissed: "yes" });
    const s = new OrbitState(m);
    expect(s.onboarding()).toEqual({ done: ["setup"], dismissed: false, welcomed: false });
    expect(await s.markStep("bogus" as never)).toBe(false);
  });
});

describe("OrbitState chat sets", () => {
  const A = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
  const B = "11111111-2222-4333-8444-555555555555";
  const mem = () => {
    const m = new Map<string, unknown>();
    return {
      get: <T>(k: string, d: T) => (m.has(k) ? (m.get(k) as T) : d),
      update: async (k: string, v: unknown) => void m.set(k, v),
    };
  };

  it("archives and hides chats, unpinning them, and brings them back", async () => {
    const s = new OrbitState(mem());
    await s.setPin(A, true);
    await s.mark("archived", [A, B], true);
    expect(s.marked("archived").sort()).toEqual([A, B].sort());
    expect(s.pins()).toEqual([]);
    await s.mark("archived", [A], false);
    expect(s.marked("archived")).toEqual([B]);
    await s.mark("hidden", [B, "not-an-id"], true);
    expect(s.marked("hidden")).toEqual([B]);
  });

  it("keeps pins for temporary chats", async () => {
    const s = new OrbitState(mem());
    await s.setPin(A, true);
    await s.mark("temp", [A], true);
    expect(s.pins()).toEqual([A]);
  });
});
