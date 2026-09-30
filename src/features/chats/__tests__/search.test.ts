import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type Ctx, L, writeSession } from "../../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { searchMessages } from "../search";

const tmp = useTmpDir();
const CWD = join("/work", "shop");

function chats(...builds: ((c: Ctx) => (Record<string, unknown> | string)[])[]) {
  const home = tmp();
  return builds.map((b) => {
    const s = writeSession(home, CWD, b);
    return { id: s.id, file: s.file };
  });
}

const toolResult = (c: Ctx, content: string) => ({
  ...L.toolResult(c),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content }] },
});

describe("searchMessages", () => {
  it("finds prompts and replies case-insensitively, counting every match", async () => {
    const files = chats((c) => [
      L.user(c, "Fix the Login bug"),
      L.assistant(c, "claude-opus-5-5", undefined, {
        text: "The LOGIN form had a typo; login works now.",
      }),
    ]);
    const hits = await searchMessages(files, "login");
    expect(hits).toEqual([{ sessionId: files[0]!.id, snippet: "Fix the Login bug", count: 3 }]);
  });

  it("cuts a snippet around the first match with ellipses", async () => {
    const text = `${"a ".repeat(200)}needle${" b".repeat(200)}`;
    const files = chats((c) => [L.user(c, text)]);
    const [hit] = await searchMessages(files, "NEEDLE");
    expect(hit!.snippet.startsWith("…")).toBe(true);
    expect(hit!.snippet.endsWith("…")).toBe(true);
    expect(hit!.snippet).toContain("needle");
    expect(hit!.snippet.length).toBeGreaterThan(120);
    expect(hit!.snippet.length).toBeLessThanOrEqual(145);
  });

  it("ignores tool results, tool inputs, JSON keys, meta and subagent lines", async () => {
    const files = chats((c) => [
      L.user(c, "hello"),
      L.toolUse(c, "Bash", { command: "grep secretword" }),
      toolResult(c, "secretword found"),
      L.meta(c, "secretword in a caveat"),
      { ...L.user(c, "secretword from a subagent"), isSidechain: true },
      L.assistant(c, "m", undefined, { sidechain: true, text: "secretword" }),
    ]);
    expect(await searchMessages(files, "secretword")).toEqual([]);
    expect(await searchMessages(files, "sessionId")).toEqual([]);
    expect(await searchMessages(files, "role")).toEqual([]);
  });

  it("matches text containing quotes and backslashes", async () => {
    const files = chats((c) => [L.user(c, 'say "hi" to C:\\temp')]);
    expect(await searchMessages(files, '"hi" to c:\\')).toHaveLength(1);
  });

  it("keeps the order of the files given, skipping chats without a match", async () => {
    const files = chats(
      (c) => [L.user(c, "tea please")],
      (c) => [L.user(c, "coffee please")],
      (c) => [L.user(c, "more tea")],
    );
    const hits = await searchMessages(files, "tea");
    expect(hits.map((h) => h.sessionId)).toEqual([files[0]!.id, files[2]!.id]);
  });

  it("stops at maxHits and reports progress", async () => {
    const files = chats(
      (c) => [L.user(c, "tea 1")],
      (c) => [L.user(c, "tea 2")],
      (c) => [L.user(c, "tea 3")],
    );
    const progress: [number, number][] = [];
    const hits = await searchMessages(files, "tea", {
      maxHits: 2,
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(hits).toHaveLength(2);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
    ]);
  });

  it("stops early when aborted", async () => {
    const files = chats(
      (c) => [L.user(c, "tea 1")],
      (c) => [L.user(c, "tea 2")],
      (c) => [L.user(c, "tea 3")],
    );
    const ac = new AbortController();
    const seen: number[] = [];
    const hits = await searchMessages(files, "tea", {
      signal: ac.signal,
      onProgress: (d) => {
        seen.push(d);
        ac.abort();
      },
    });
    expect(seen).toEqual([1]);
    expect(hits.map((h) => h.sessionId)).toEqual([files[0]!.id]);
    expect(await searchMessages(files, "tea", { signal: ac.signal })).toEqual([]);
  });

  it("stops inside a long file when aborted", async () => {
    const ac = new AbortController();
    const files = chats((c) =>
      Array.from({ length: 5000 }, (_, i) =>
        L.user(c, i === 0 || i === 4999 ? `tea ${i}` : `line ${i}`),
      ),
    );
    // Only lines that pass the prefilter are parsed, so parse calls show how far it read.
    const parse = vi.spyOn(JSON, "parse");
    try {
      const done = searchMessages(files, "tea", { signal: ac.signal });
      ac.abort();
      expect(await done).toEqual([]);
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });

  it("returns [] for queries shorter than two characters and for missing files", async () => {
    const files = chats((c) => [L.user(c, "a b c")]);
    expect(await searchMessages(files, "a")).toEqual([]);
    expect(await searchMessages(files, "  b ")).toEqual([]);
    expect(await searchMessages([{ id: "x", file: join(tmp(), "none.jsonl") }], "tea")).toEqual([]);
  });
});
