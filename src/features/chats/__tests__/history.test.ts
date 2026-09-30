import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { applyPromptCounts, PromptCounter, readPromptCounts } from "../history";
import type { Session } from "../types";

const tmp = useTmpDir();
const A = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const B = "11111111-2222-4333-8444-555555555555";

const line = (sessionId: string, timestamp: number) =>
  JSON.stringify({ display: "p ü", pastedContents: {}, timestamp, project: "C:\\x", sessionId });

describe("readPromptCounts", () => {
  it("counts prompts per session and remembers the latest time", async () => {
    const home = tmp();
    writeFileSync(
      join(home, "history.jsonl"),
      [line(A, 1), line(A, 5), line(B, 3), "{bad", line("not-a-uuid", 9)].join("\n"),
    );
    const m = await readPromptCounts(home);
    expect(m.get(A)).toEqual({ count: 2, last: 5 });
    expect(m.get(B)).toEqual({ count: 1, last: 3 });
    expect(m.size).toBe(2);
  });

  it("returns an empty map when there is no history", async () => {
    expect((await readPromptCounts(tmp())).size).toBe(0);
  });
});

describe("PromptCounter (incremental)", () => {
  it("reads only what was appended since the last update", async () => {
    const home = tmp();
    const f = join(home, "history.jsonl");
    writeFileSync(f, `${line(A, 1)}\n${line(A, 2)}\n`);
    const c = new PromptCounter(home);
    expect((await c.update()).get(A)?.count).toBe(2);
    appendFileSync(f, `${line(A, 3)}\n${line(B, 4)}\n`);
    const m = await c.update();
    expect(m.get(A)).toEqual({ count: 3, last: 3 });
    expect(m.get(B)?.count).toBe(1);
  });

  it("does not count a half-written last line until it is complete", async () => {
    const home = tmp();
    const f = join(home, "history.jsonl");
    const full = line(B, 7);
    writeFileSync(f, `${line(A, 1)}\n${full.slice(0, 20)}`);
    const c = new PromptCounter(home);
    expect((await c.update()).get(B)).toBeUndefined();
    appendFileSync(f, `${full.slice(20)}\n`);
    expect((await c.update()).get(B)?.count).toBe(1);
    expect((await c.update()).get(A)?.count).toBe(1);
  });

  it("starts over when the file shrinks (rewritten or rotated)", async () => {
    const home = tmp();
    const f = join(home, "history.jsonl");
    writeFileSync(f, `${line(A, 1)}\n${line(A, 2)}\n${line(A, 3)}\n`);
    const c = new PromptCounter(home);
    await c.update();
    writeFileSync(f, `${line(B, 9)}\n`);
    const m = await c.update();
    expect(m.get(A)).toBeUndefined();
    expect(m.get(B)?.count).toBe(1);
  });
});

describe("applyPromptCounts", () => {
  const s = (id: string, prompts: number, estimated: boolean, entrypoint = "cli") =>
    ({ id, prompts, estimated, entrypoint }) as Session;

  it("uses the exact count from history for terminal chats and clears the estimate", () => {
    const [r] = applyPromptCounts([s(A, 3, true)], new Map([[A, { count: 40, last: 1 }]]));
    expect(r).toMatchObject({ prompts: 40, estimated: false });
  });

  it("keeps the estimate for chats started elsewhere, whose prompts may be missing from history", () => {
    const [r] = applyPromptCounts(
      [s(A, 3, true, "claude-vscode")],
      new Map([[A, { count: 2, last: 1 }]]),
    );
    expect(r).toMatchObject({ prompts: 3, estimated: true });
  });

  it("keeps the transcript count when history knows less", () => {
    const [r] = applyPromptCounts([s(A, 7, false)], new Map([[A, { count: 2, last: 1 }]]));
    expect(r).toMatchObject({ prompts: 7, estimated: false });
  });

  it("leaves sessions unknown to history untouched", () => {
    const orig = s(B, 3, true);
    const [r] = applyPromptCounts([orig], new Map());
    expect(r).toBe(orig);
  });
});
