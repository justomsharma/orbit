import { describe, expect, it } from "vitest";
import { forEachJsonLine } from "../jsonl";

function collect(text: string) {
  const out: unknown[] = [];
  forEachJsonLine(text, (o) => out.push(o));
  return out;
}

describe("forEachJsonLine", () => {
  it("parses one object per line, including CRLF endings", () => {
    expect(collect('{"a":1}\r\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips blank, corrupt and partial lines", () => {
    expect(collect('{"a":1}\n\nnot json\n{"b":')).toEqual([{ a: 1 }]);
  });

  it("skips values that are not objects", () => {
    expect(collect('1\n"s"\nnull\n[1]\n{"ok":true}')).toEqual([{ ok: true }]);
  });
});
