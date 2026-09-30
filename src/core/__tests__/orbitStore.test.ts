import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { OrbitStore } from "../orbitStore";

const tmp = useTmpDir();

describe("OrbitStore", () => {
  it("rejects names that are not simple lowercase .json files", async () => {
    const d = tmp();
    const s = new OrbitStore(d);
    for (const name of ["../x.json", "A.json", "x.txt", "sub/x.json", ".json", "x.json.tmp"]) {
      await expect(s.write(name, {})).rejects.toThrow();
      await expect(s.read(name, null)).rejects.toThrow();
    }
    expect(readdirSync(d)).toEqual([]);
    expect(existsSync(join(d, "..", "x.json"))).toBe(false);
  });

  it("returns the fallback for a missing or corrupt file", async () => {
    const d = tmp();
    const s = new OrbitStore(d);
    expect(await s.read("pins.json", { pins: [] })).toEqual({ pins: [] });
    writeFileSync(join(d, "pins.json"), "{half");
    expect(await s.read("pins.json", { pins: [] })).toEqual({ pins: [] });
  });

  it("writes atomically, creating the folder, and reads the value back", async () => {
    const d = join(tmp(), "storage", "nested");
    const s = new OrbitStore(d);
    await s.write("usage-index.json", { v: 1, files: { a: 1 } });
    await s.write("usage-index.json", { v: 1, files: { b: 2 } });
    expect(await s.read("usage-index.json", null)).toEqual({ v: 1, files: { b: 2 } });
    expect(JSON.parse(readFileSync(join(d, "usage-index.json"), "utf8"))).toEqual({
      v: 1,
      files: { b: 2 },
    });
    expect(readdirSync(d)).toEqual(["usage-index.json"]);
  });

  it("survives parallel writes to different names", async () => {
    const d = tmp();
    const s = new OrbitStore(d);
    await Promise.all(["a", "b", "c"].map((n) => s.write(`${n}.json`, n)));
    expect(readdirSync(d).sort()).toEqual(["a.json", "b.json", "c.json"]);
    expect(await s.read("b.json", "")).toBe("b");
  });
});
