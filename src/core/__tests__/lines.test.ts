import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { streamJsonLines } from "../lines";

const tmp = useTmpDir();

describe("streamJsonLines", () => {
  it("visits every JSON object line of a large file without loading it at once", async () => {
    const d = tmp();
    const n = 50_000;
    writeFileSync(
      join(d, "big.jsonl"),
      Array.from({ length: n }, (_, i) => JSON.stringify({ i })).join("\n"),
    );
    let seen = 0;
    await streamJsonLines(join(d, "big.jsonl"), () => {
      seen++;
    });
    expect(seen).toBe(n);
  });

  it("skips bad lines and resolves quietly for a missing file", async () => {
    const d = tmp();
    writeFileSync(join(d, "x.jsonl"), '{"a":1}\r\nnope\n{"b":2}');
    const got: unknown[] = [];
    await streamJsonLines(join(d, "x.jsonl"), (o) => {
      got.push(o);
    });
    expect(got).toEqual([{ a: 1 }, { b: 2 }]);
    await expect(streamJsonLines(join(d, "missing"), () => {})).resolves.toBeUndefined();
  });

  it("stops early when the callback returns false", async () => {
    const d = tmp();
    writeFileSync(join(d, "s.jsonl"), '{"a":1}\n{"a":2}\n{"a":3}\n');
    let seen = 0;
    await streamJsonLines(join(d, "s.jsonl"), () => ++seen < 2);
    expect(seen).toBe(2);
  });
});
