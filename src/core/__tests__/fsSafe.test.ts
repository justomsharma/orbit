import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { listDirSafe, readHeadTail, readTextSafe } from "../fsSafe";

const tmp = useTmpDir();

function canSymlink(dir: string): boolean {
  try {
    writeFileSync(join(dir, "probe-target"), "x");
    symlinkSync(join(dir, "probe-target"), join(dir, "probe-link"));
    return true;
  } catch {
    return false;
  }
}

describe("readTextSafe", () => {
  it("reads a normal file", async () => {
    const d = tmp();
    writeFileSync(join(d, "a.txt"), "hello");
    expect(await readTextSafe(join(d, "a.txt"))).toBe("hello");
  });

  it("returns null for a missing file", async () => {
    expect(await readTextSafe(join(tmp(), "nope"))).toBeNull();
  });

  it("returns null for a directory", async () => {
    const d = tmp();
    mkdirSync(join(d, "sub"));
    expect(await readTextSafe(join(d, "sub"))).toBeNull();
  });

  it("returns null when the file is larger than the cap", async () => {
    const d = tmp();
    writeFileSync(join(d, "big"), "x".repeat(100));
    expect(await readTextSafe(join(d, "big"), 10)).toBeNull();
  });

  it("refuses to follow a symlink", async (ctx) => {
    const d = tmp();
    if (!canSymlink(d)) ctx.skip();
    writeFileSync(join(d, "secret"), "s");
    symlinkSync(join(d, "secret"), join(d, "link"));
    expect(await readTextSafe(join(d, "link"))).toBeNull();
  });
});

describe("readHeadTail", () => {
  it("returns the whole file as head when it is small", async () => {
    const d = tmp();
    writeFileSync(join(d, "s.jsonl"), "a\nb\n");
    const r = await readHeadTail(join(d, "s.jsonl"), 1024, 1024);
    expect(r).toMatchObject({ head: "a\nb\n", tail: "", whole: true, size: 4 });
  });

  it("returns only complete lines from head and tail of a large file", async () => {
    const d = tmp();
    const lines = Array.from({ length: 200 }, (_, i) => `line-${String(i).padStart(3, "0")}`);
    writeFileSync(join(d, "l.jsonl"), `${lines.join("\n")}\n`);
    const r = await readHeadTail(join(d, "l.jsonl"), 50, 50);
    expect(r?.whole).toBe(false);
    for (const l of r!.head.split("\n").filter(Boolean)) expect(lines).toContain(l);
    for (const l of r!.tail.split("\n").filter(Boolean)) expect(lines).toContain(l);
    expect(r!.head.startsWith("line-000")).toBe(true);
    expect(r!.tail.trimEnd().endsWith("line-199")).toBe(true);
  });

  it("keeps multi-byte characters intact at the cut", async () => {
    const d = tmp();
    const body = `${"é".repeat(40)}\n${"ü".repeat(40)}\n${"ö".repeat(40)}\n`;
    writeFileSync(join(d, "u.jsonl"), body);
    const r = await readHeadTail(join(d, "u.jsonl"), 90, 90);
    expect(r!.head).not.toContain("�");
    expect(r!.tail).not.toContain("�");
  });

  it("returns null for a missing file", async () => {
    expect(await readHeadTail(join(tmp(), "none"), 10, 10)).toBeNull();
  });
});

describe("listDirSafe", () => {
  it("lists entries and returns [] for a missing directory", async () => {
    const d = tmp();
    writeFileSync(join(d, "x"), "");
    expect((await listDirSafe(d)).map((e) => e.name)).toEqual(["x"]);
    expect(await listDirSafe(join(d, "missing"))).toEqual([]);
  });
});
