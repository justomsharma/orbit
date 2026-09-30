import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { readAppendedLines } from "../lines";

const tmp = useTmpDir();

describe("readAppendedLines", () => {
  it("returns complete lines from a byte offset and the offset to resume from", async () => {
    const f = join(tmp(), "a.jsonl");
    writeFileSync(f, "één\ntwo\nthr");
    const a = await readAppendedLines(f, 0);
    expect(a).toEqual({ lines: ["één", "two"], next: Buffer.byteLength("één\ntwo\n") });
    appendFileSync(f, "ee\nfour\n");
    const b = await readAppendedLines(f, a!.next);
    expect(b!.lines).toEqual(["three", "four"]);
    expect(await readAppendedLines(f, b!.next)).toEqual({ lines: [], next: b!.next });
  });

  it("returns null when the file is missing or shorter than the offset", async () => {
    const d = tmp();
    expect(await readAppendedLines(join(d, "none"), 0)).toBeNull();
    const f = join(d, "b.jsonl");
    writeFileSync(f, "x\n");
    expect(await readAppendedLines(f, 99)).toBeNull();
  });
});
