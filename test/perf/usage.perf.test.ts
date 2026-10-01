import { describe, expect, it } from "vitest";
import { UsageIndex } from "../../src/features/usage/index";
import { L, writeSession } from "../helpers/fakeHome";
import { useTmpDir } from "../helpers/tmp";
import { budget } from "./budget";

const tmp = useTmpDir();

describe("usage index performance", () => {
  it("indexes 200 transcripts × 500 assistant lines quickly, then skips unchanged files", async () => {
    const home = tmp();
    for (let i = 0; i < 200; i++) {
      writeSession(home, `/code/p${i % 20}`, (c) => {
        const lines: Record<string, unknown>[] = [L.user(c, `task ${i}`)];
        // Real transcripts write one message as several lines with the same id.
        for (let j = 0; j < 250; j++) {
          const id = `msg_${i}_${j}`;
          lines.push(
            L.assistant(c, "claude-opus-5-5", undefined, { id, text: "thinking ".repeat(20) }),
          );
          lines.push(
            L.assistant(c, "claude-opus-5-5", undefined, { id, text: "Done. ".repeat(20) }),
          );
        }
        return lines;
      });
    }
    const idx = new UsageIndex(home);

    let t0 = performance.now();
    expect(await idx.update()).toEqual({ changed: true });
    const first = performance.now() - t0;
    expect(idx.records()).toHaveLength(200 * 250);

    t0 = performance.now();
    expect(await idx.update()).toEqual({ changed: false });
    const second = performance.now() - t0;

    console.log(`usage index: first ${first.toFixed(0)} ms, unchanged ${second.toFixed(1)} ms`);
    expect(first).toBeLessThan(budget(4000));
    expect(second).toBeLessThan(budget(200));
  });
});
