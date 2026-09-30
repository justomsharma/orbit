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
});
