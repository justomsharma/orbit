import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { jsonProblem, readJsonFile } from "../jsonFile";
import { put } from "./configFixture";

const tmp = useTmpDir();

describe("jsonProblem", () => {
  it("names comments, trailing commas and empty files", () => {
    expect(jsonProblem('{\n  // model\n  "model": "opus"\n}')).toBe(
      "Not valid JSON: comments are not allowed (line 2)",
    );
    expect(jsonProblem('{ /* x */ "a": 1 }')).toBe(
      "Not valid JSON: comments are not allowed (line 1)",
    );
    expect(jsonProblem('{\n  "a": [1, 2,],\n  "b": 1\n}')).toBe(
      "Not valid JSON: trailing commas are not allowed (line 2)",
    );
    expect(jsonProblem("  \n")).toBe("Not valid JSON: the file is empty");
  });

  it("does not mistake slashes and commas inside strings", () => {
    expect(jsonProblem('{ "url": "https://x.dev/a,}", "a": }')).toMatch(/^Not valid JSON: /);
    expect(jsonProblem('{ "url": "https://x.dev/a,}", "a": }')).not.toMatch(/comments|trailing/);
  });

  it("names the top-level kind when it is not an object", () => {
    expect(jsonProblem("[]")).toBe("Expected a JSON object at the top level, found an array");
    expect(jsonProblem('"x"')).toBe("Expected a JSON object at the top level, found a string");
    expect(jsonProblem("null")).toBe("Expected a JSON object at the top level, found null");
  });

  it("never quotes the file's content (it may hold secrets)", () => {
    const msg = jsonProblem('{ "env": { "API_KEY": "sk-secret-123" ');
    expect(msg).toMatch(/^Not valid JSON: /);
    expect(msg).not.toContain("sk-secret");
  });
});

describe("readJsonFile", () => {
  it("reports a missing file without an error", async () => {
    expect(await readJsonFile(join(tmp(), "nope.json"))).toEqual({
      path: expect.stringContaining("nope.json"),
      exists: false,
      data: null,
      error: null,
      skipped: null,
    });
  });

  it("parses an object and tolerates a BOM", async () => {
    const p = put(join(tmp(), "a.json"), '﻿{ "a": 1 }');
    expect(await readJsonFile(p)).toMatchObject({ exists: true, data: { a: 1 }, error: null });
  });

  it("skips files over the size cap without calling them broken", async () => {
    const p = put(join(tmp(), "big.json"), `{"a":"${"x".repeat(2000)}"}`);
    expect(await readJsonFile(p, { maxBytes: 1000 })).toMatchObject({
      exists: true,
      data: null,
      error: null,
      skipped: "too-large",
    });
  });

  it("keeps the error for JSON that doesn't parse", async () => {
    const p = put(join(tmp(), "bad.json"), '{ "a": 1, }');
    expect(await readJsonFile(p)).toMatchObject({
      data: null,
      error: expect.stringMatching(/trailing commas/),
      skipped: null,
    });
  });

  it("skips a folder where a file should be", async () => {
    const d = join(tmp(), "dir.json");
    mkdirSync(d);
    expect(await readJsonFile(d)).toMatchObject({ data: null, error: null, skipped: "unreadable" });
  });

  it("skips a symbolic link unless asked to follow it", async (ctx) => {
    const d = tmp();
    writeFileSync(join(d, "target.json"), '{ "a": 1 }');
    try {
      symlinkSync(join(d, "target.json"), join(d, "link.json"));
    } catch {
      ctx.skip();
    }
    expect(await readJsonFile(join(d, "link.json"))).toMatchObject({
      exists: true,
      data: null,
      error: null,
      skipped: "link",
    });
    expect(await readJsonFile(join(d, "link.json"), { followLinks: true })).toMatchObject({
      exists: true,
      data: { a: 1 },
      error: null,
      skipped: null,
    });
  });
});
