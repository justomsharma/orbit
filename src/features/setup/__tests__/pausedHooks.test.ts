import { describe, expect, it } from "vitest";
import type { HookEntry } from "../hooks";
import { type PausedHook, PausedHooks, pausedFor } from "../pausedHooks";

const FILE = "/u/.claude/settings.json";

const active = (over: Partial<HookEntry>): HookEntry => ({
  id: "x",
  scope: "user",
  source: FILE,
  plugin: null,
  event: "Stop",
  matcher: null,
  group: 0,
  index: 0,
  type: "command",
  command: null,
  url: null,
  timeout: null,
  ...over,
});

const paused = (handler: Record<string, unknown>): PausedHook => ({
  id: "p1",
  scope: "user",
  source: FILE,
  event: "Stop",
  matcher: null,
  handler,
  at: 1,
});

describe("pausedFor", () => {
  it("hides a paused hook only when the very same one is back in its file", () => {
    const p = paused({ type: "command", command: "a.sh" });
    expect(pausedFor([p], [FILE], [active({ command: "a.sh" })], "linux")).toEqual([]);
    expect(pausedFor([p], [FILE], [active({ command: "b.sh" })], "linux")).toHaveLength(1);
  });

  it("never mixes up two hooks without a command, like two http hooks", () => {
    const p = paused({ type: "http", url: "https://a/hook" });
    const other = active({ type: "http", url: "https://b/hook" });
    expect(pausedFor([p], [FILE], [other], "linux")).toHaveLength(1);
    const prompt = paused({ type: "prompt", prompt: "Check the work" });
    expect(pausedFor([prompt], [FILE], [active({ type: "prompt" })], "linux")).toHaveLength(1);
  });
});

describe("PausedHooks", () => {
  it("refuses to pause more than it can keep, instead of forgetting old ones", async () => {
    let data: unknown = Array.from({ length: 200 }, (_, i) => ({
      ...paused({ command: `${i}` }),
      id: `${i}`,
    }));
    const store = {
      read: async <T>(_n: string, fallback: T) => (data ?? fallback) as T,
      write: async (_n: string, v: unknown) => {
        data = v;
      },
    };
    const p = new PausedHooks(store);
    await expect(p.add(paused({ command: "new" }))).rejects.toThrow(/at most 200/);
    expect((await p.list())[0]!.id).toBe("0");
  });
});
