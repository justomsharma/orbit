import { describe, expect, it } from "vitest";
import { detectIndent, parseJsonObject, stringifyLike } from "../json";

describe("detectIndent", () => {
  it("detects tabs, 2 and 4 spaces", () => {
    expect(detectIndent('{\n\t"a": 1\n}')).toBe("\t");
    expect(detectIndent('{\n  "a": 1\n}')).toBe(2);
    expect(detectIndent('{\n    "a": {\n        "b": 1\n    }\n}')).toBe(4);
  });

  it("works with CRLF line endings", () => {
    expect(detectIndent('{\r\n    "a": 1\r\n}\r\n')).toBe(4);
  });

  it("defaults to 2 for one-line or empty text", () => {
    expect(detectIndent('{"a":1}')).toBe(2);
    expect(detectIndent("")).toBe(2);
  });
});

describe("stringifyLike", () => {
  it("uses the original indentation", () => {
    expect(stringifyLike({ a: 1 }, '{\n\t"x": 0\n}\n')).toBe('{\n\t"a": 1\n}\n');
    expect(stringifyLike({ a: 1 }, '{\n    "x": 0\n}\n')).toBe('{\n    "a": 1\n}\n');
  });

  it("keeps a missing trailing newline missing", () => {
    expect(stringifyLike({ a: 1 }, '{\n  "x": 0\n}')).toBe('{\n  "a": 1\n}');
  });

  it("adds a trailing newline for a new or empty file", () => {
    expect(stringifyLike({ a: 1 }, null)).toBe('{\n  "a": 1\n}\n');
    expect(stringifyLike({ a: 1 }, "")).toBe('{\n  "a": 1\n}\n');
  });

  it("keeps CRLF line endings", () => {
    expect(stringifyLike({ a: 1, b: "x\ny" }, '{\r\n  "x": 0\r\n}\r\n')).toBe(
      '{\r\n  "a": 1,\r\n  "b": "x\\ny"\r\n}\r\n',
    );
  });

  it("keeps a UTF-8 BOM", () => {
    expect(stringifyLike({ a: 1 }, '﻿{\n  "x": 0\n}\n')).toBe('﻿{\n  "a": 1\n}\n');
  });
});

describe("parseJsonObject", () => {
  it("parses a plain object and keeps key order", () => {
    expect(Object.keys(parseJsonObject('{"b":1,"a":2,"c":3}')!)).toEqual(["b", "a", "c"]);
  });

  it("tolerates a UTF-8 BOM", () => {
    expect(parseJsonObject('﻿{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null for anything that is not a plain JSON object", () => {
    for (const t of ["{ // comment\n}", "[1]", "nul", "null", "1", '"s"', "", "{", '{"a":1,}']) {
      expect(parseJsonObject(t)).toBeNull();
    }
  });
});
