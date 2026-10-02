import { describe, expect, it } from "vitest";
import { L, writeSession } from "../../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { ConversationCache, pageOf, readTurns } from "../conversation";

const tmp = useTmpDir();
const at = (min: number) => new Date(Date.UTC(2026, 8, 20, 10, min)).toISOString();

function chat(home: string) {
  return writeSession(home, "/code/shop", (c) => [
    L.user(c, "Fix the checkout bug", at(0)),
    L.assistant(c, "claude-opus-5-5", at(1), {
      id: "m1",
      text: "Looking at cart.ts",
      output: 20,
      input: 5,
      read: 100,
    }),
    L.toolUse(
      c,
      "Read",
      { file_path: "/code/shop/cart.ts" },
      { id: "m1", output: 30, input: 5, read: 100 },
    ),
    L.toolResult(c),
    L.assistant(c, "claude-opus-5-5", at(5), {
      id: "m2",
      blocks: [
        { type: "thinking", thinking: "The race is in the lock" },
        { type: "text", text: "Fixed: added a lock." },
      ],
      output: 40,
      input: 7,
    }),
    L.user(c, "Thanks, now add tests", at(9)),
  ]);
}

describe("readTurns", () => {
  it("makes one turn per person message and per Claude reply, with tools and thinking", async () => {
    const s = chat(tmp());
    const { turns, stats } = await readTurns(s.file);
    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["you", "Fix the checkout bug"],
      ["claude", "Looking at cart.ts"],
      ["claude", "Fixed: added a lock."],
      ["you", "Thanks, now add tests"],
    ]);
    expect(turns[1]!.tools).toEqual([{ name: "Read", arg: "/code/shop/cart.ts" }]);
    expect(turns[2]!.thinking).toBe("The race is in the lock");
    expect(stats.messages).toBe(4);
    expect(stats.tools).toBe(1);
    // A reply split over two lines counts its tokens once.
    expect(stats.tokens.output).toBe(20 + 40);
    expect(stats.durationMs).toBe(9 * 60_000);
  });
});

describe("pageOf", () => {
  it("shows the newest turns first, or the oldest, a page at a time", async () => {
    const all = await readTurns(chat(tmp()).file);
    expect(pageOf(all, { order: "latest", limit: 2, query: "" }).turns.map((t) => t.text)).toEqual([
      "Thanks, now add tests",
      "Fixed: added a lock.",
    ]);
    const first = pageOf(all, { order: "earliest", limit: 2, query: "" });
    expect(first.turns.map((t) => t.text)).toEqual(["Fix the checkout bug", "Looking at cart.ts"]);
    expect(first.total).toBe(4);
    expect(first.matches).toBeNull();
  });

  it("finds every match in text, thinking and tools, newest first", async () => {
    const all = await readTurns(chat(tmp()).file);
    expect(
      pageOf(all, { order: "latest", limit: 1, query: "LOCK" }).turns.map((t) => t.text),
    ).toEqual(["Fixed: added a lock."]);
    const tool = pageOf(all, { order: "latest", limit: 1, query: "cart.ts" });
    expect(tool.matches).toBe(1);
  });

  it("cuts long text in the list but not in search results", async () => {
    const home = tmp();
    const long = "x".repeat(900);
    const s = writeSession(home, "/code/shop", (c) => [L.user(c, long, at(0))]);
    const all = await readTurns(s.file);
    expect(pageOf(all, { order: "latest", limit: 50, query: "" }).turns[0]!.text.length).toBe(501);
    expect(pageOf(all, { order: "latest", limit: 50, query: "xxx" }).turns[0]!.text.length).toBe(
      900,
    );
  });
});

describe("ConversationCache", () => {
  it("parses a transcript once while it's unchanged", async () => {
    const s = chat(tmp());
    const cache = new ConversationCache();
    const a = await cache.get(s.file);
    expect(await cache.get(s.file)).toBe(a);
    expect(await cache.get(`${s.file}.missing`)).toBeNull();
  });
});
