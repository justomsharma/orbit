import { appendFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { expandPrompt, PromptLibrary } from "../library";

const tmp = useTmpDir();
const A = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const B = "11111111-2222-4333-8444-555555555555";

const line = (
  display: string,
  timestamp: number,
  o: { sessionId?: string; project?: string; pasted?: Record<string, unknown> } = {},
) =>
  JSON.stringify({
    display,
    pastedContents: o.pasted ?? {},
    timestamp,
    project: o.project ?? "C:\\code\\shop",
    sessionId: o.sessionId ?? A,
  });

function home(lines: string[]): string {
  const h = tmp();
  writeFileSync(join(h, "history.jsonl"), `${lines.join("\n")}\n`);
  return h;
}

describe("PromptLibrary", () => {
  it("collapses repeats into one entry with a count, newest first", async () => {
    const h = home([
      line("fix the failing tests", 1),
      line("write a changelog", 2, { sessionId: B, project: "/srv/api" }),
      line("fix the failing tests\n", 3, { sessionId: B }),
    ]);
    const list = await new PromptLibrary(h).update();
    expect(list.map((p) => p.text)).toEqual(["fix the failing tests", "write a changelog"]);
    expect(list[0]).toMatchObject({ count: 2, first: 1, last: 3, sessionId: B });
    expect(list[1]).toMatchObject({ count: 1, project: "/srv/api", sessionId: B });
  });

  it("keeps the line breaks of multi-line prompts", async () => {
    const h = home([line("step one\n\nstep two", 1), line("step one step two", 2)]);
    const list = await new PromptLibrary(h).update();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ count: 2, text: "step one step two" });
    const h2 = home([line("  step one\n\nstep two  ", 1)]);
    expect((await new PromptLibrary(h2).update())[0]?.text).toBe("step one\n\nstep two");
  });

  it("keeps prompts apart when the same placeholder hides different pasted text", async () => {
    const paste = (x: Record<string, unknown>) => ({ "1": { id: 1, type: "text", ...x } });
    const h = home([
      line("[Pasted text #1 +24 lines]", 1, { pasted: paste({ contentHash: "aaaaaaaaaaaaaaaa" }) }),
      line("[Pasted text #1 +24 lines]", 2, { pasted: paste({ contentHash: "bbbbbbbbbbbbbbbb" }) }),
      line("[Pasted text #1 +24 lines]", 3, { pasted: paste({ contentHash: "aaaaaaaaaaaaaaaa" }) }),
      line("[Pasted text #1 +24 lines]", 4, { pasted: paste({ content: "one" }) }),
      line("[Pasted text #1 +24 lines]", 5, { pasted: paste({ content: "two" }) }),
    ]);
    const list = await new PromptLibrary(h).update();
    expect(list.map((p) => p.count)).toEqual([1, 1, 2, 1]);
    expect(new Set(list.map((p) => p.id)).size).toBe(4);
  });

  it("gives each entry a stable id", async () => {
    const h = home([line("a", 1), line("b", 2)]);
    const one = await new PromptLibrary(h).update();
    const two = await new PromptLibrary(h).update();
    expect(one.map((p) => p.id)).toEqual(two.map((p) => p.id));
    expect(new Set(one.map((p) => p.id)).size).toBe(2);
  });

  it("leaves out bare slash commands but keeps commands with words after them", async () => {
    const h = home([line("/model", 1), line("/compact", 2), line("/review the auth change", 3)]);
    const list = await new PromptLibrary(h).update();
    expect(list.map((p) => p.text)).toEqual(["/review the auth change"]);
  });

  it("skips blank prompts, corrupt lines and bad session ids", async () => {
    const h = home([
      line("   ", 1),
      "{broken",
      JSON.stringify({ display: 42, timestamp: 2 }),
      line("keep me", 3, { sessionId: "nope" }),
    ]);
    const list = await new PromptLibrary(h).update();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ text: "keep me", sessionId: null });
  });

  it("reads only what was appended since the last update", async () => {
    const h = home([line("one", 1)]);
    const lib = new PromptLibrary(h);
    expect(await lib.update()).toHaveLength(1);
    appendFileSync(join(h, "history.jsonl"), `${line("two", 2)}\n${line("one", 3)}\n`);
    const list = await lib.update();
    expect(list.map((p) => [p.text, p.count])).toEqual([
      ["one", 2],
      ["two", 1],
    ]);
  });

  it("starts over when history is rewritten", async () => {
    const h = home([line("old one", 1), line("old two", 2)]);
    const lib = new PromptLibrary(h);
    await lib.update();
    writeFileSync(join(h, "history.jsonl"), `${line("new", 5)}\n`);
    expect((await lib.update()).map((p) => p.text)).toEqual(["new"]);
  });

  it("is empty without history", async () => {
    expect(await new PromptLibrary(tmp()).update()).toEqual([]);
  });

  it("finds an entry by id with its latest pasted text", async () => {
    const h = home([
      line("[Pasted text #1 +2 lines] review", 1, {
        pasted: { "1": { id: 1, type: "text", content: "old" } },
      }),
      line("[Pasted text #1 +2 lines] review", 2, {
        pasted: { "1": { id: 1, type: "text", content: "new" } },
      }),
    ]);
    const lib = new PromptLibrary(h);
    const [p] = await lib.update();
    expect(p?.pastes).toBe(1);
    expect(lib.get(p!.id)?.pasted).toEqual({ "1": { type: "text", content: "new" } });
    expect(lib.get("missing")).toBeNull();
  });
});

describe("expandPrompt", () => {
  const cache = (h: string, hash: string, text: string) => {
    mkdirSync(join(h, "paste-cache"), { recursive: true });
    writeFileSync(join(h, "paste-cache", `${hash}.txt`), text);
  };

  it("puts pasted text back in place of its placeholder", async () => {
    const h = tmp();
    cache(h, "31af094503797a7c", "line 1\nline 2");
    const r = await expandPrompt(h, "See [Pasted text #1 +1 lines] and [Pasted text #2]", {
      "1": { type: "text", contentHash: "31af094503797a7c" },
      "2": { type: "text", content: "inline" },
    });
    expect(r).toEqual({ text: "See line 1\nline 2 and inline", missing: 0 });
  });

  it("keeps the placeholder and counts it when the paste is gone", async () => {
    const h = tmp();
    const r = await expandPrompt(h, "x [Pasted text #1 +9 lines]", {
      "1": { type: "text", contentHash: "0000000000000000" },
    });
    expect(r).toEqual({ text: "x [Pasted text #1 +9 lines]", missing: 1 });
    const twice = await expandPrompt(h, "[Pasted text #1] [Pasted text #1]", {});
    expect(twice.missing).toBe(1);
  });

  it("never reads outside the paste cache", async () => {
    const h = tmp();
    writeFileSync(join(h, "secret.txt"), "secret");
    const r = await expandPrompt(h, "[Pasted text #1]", {
      "1": { type: "text", contentHash: "../secret" },
    });
    expect(r.text).toBe("[Pasted text #1]");
    expect(r.missing).toBe(1);
  });

  it("does not follow a symlink in the paste cache", async () => {
    const h = tmp();
    writeFileSync(join(h, "secret.txt"), "secret");
    mkdirSync(join(h, "paste-cache"));
    try {
      symlinkSync(join(h, "secret.txt"), join(h, "paste-cache", "aaaaaaaaaaaaaaaa.txt"));
    } catch {
      return; // symlinks need extra rights on some Windows machines
    }
    const r = await expandPrompt(h, "[Pasted text #1]", {
      "1": { type: "text", contentHash: "aaaaaaaaaaaaaaaa" },
    });
    expect(r.text).toBe("[Pasted text #1]");
  });

  it("leaves text without placeholders alone and does not treat $ specially", async () => {
    const r = await expandPrompt(tmp(), "cost $1 [Pasted text #1]", {
      "1": { type: "text", content: "$& $1" },
    });
    expect(r.text).toBe("cost $1 $& $1");
  });
});
