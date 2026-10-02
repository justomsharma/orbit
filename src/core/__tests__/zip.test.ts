import { describe, expect, it } from "vitest";
import { crc32, unzip, zip } from "../zip";

describe("zip", () => {
  it("round-trips files with UTF-8 names", () => {
    const files = [
      { name: "manifest.json", data: Buffer.from('{"version":1}') },
      { name: "sessions/ünï.jsonl", data: Buffer.from("line 1\nline 2\n") },
      { name: "empty.txt", data: Buffer.alloc(0) },
    ];
    expect(unzip(zip(files))).toEqual(files);
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("refuses damaged or foreign archives", () => {
    const z = zip([{ name: "a.txt", data: Buffer.from("hello") }]);
    const bad = Buffer.from(z);
    bad[30 + 5] = 0x41; // change a byte of the content
    expect(() => unzip(bad)).toThrow(/damaged/);
    expect(() => unzip(Buffer.from("not a zip at all, sorry"))).toThrow(/isn't a zip/);
  });
});
