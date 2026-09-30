import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { applyPromptCounts, readPromptCounts } from "../history";
import type { Session } from "../types";

const tmp = useTmpDir();
const A = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const B = "11111111-2222-4333-8444-555555555555";

const line = (sessionId: string, timestamp: number) =>
  JSON.stringify({ display: "p", pastedContents: {}, timestamp, project: "C:\\x", sessionId });

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

describe("applyPromptCounts", () => {
  const s = (id: string, prompts: number, estimated: boolean) =>
    ({ id, prompts, estimated }) as Session;

  it("uses the exact count from history when it is higher and clears the estimate", () => {
    const [r] = applyPromptCounts([s(A, 3, true)], new Map([[A, { count: 40, last: 1 }]]));
    expect(r).toMatchObject({ prompts: 40, estimated: false });
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
