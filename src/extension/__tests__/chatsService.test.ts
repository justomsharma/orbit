import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { L, writeSession } from "../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../test/helpers/tmp";
import { ChatsService } from "../chatsService";

const tmp = useTmpDir();

describe("ChatsService", () => {
  it("combines chats, exact prompt counts, live status and this-folder ids", async () => {
    const home = tmp();
    const here = writeSession(home, "/code/shop", (c) => [L.user(c, "a"), L.user(c, "b")]);
    const sub = writeSession(home, "/code/shop/packages/ui", (c) => [L.user(c, "c")]);
    const away = writeSession(home, "/code/api", (c) => [L.user(c, "d")]);
    writeFileSync(
      join(home, "history.jsonl"),
      Array.from(
        { length: 9 },
        (_, i) =>
          `${JSON.stringify({ display: "x", timestamp: i, project: "/code/shop", sessionId: here.id })}\n`,
      ).join(""),
    );
    mkdirSync(join(home, "sessions"));
    writeFileSync(
      join(home, "sessions", "77.json"),
      JSON.stringify({ pid: 77, sessionId: away.id, status: "busy" }),
    );

    const svc = new ChatsService(home, { platform: "linux", isAlive: () => true });
    const snap = await svc.snapshot(["/code/shop"]);

    expect(snap.items.map((s) => s.id).sort()).toEqual([here.id, sub.id, away.id].sort());
    expect(snap.items.find((s) => s.id === here.id)?.prompts).toBe(9);
    expect(snap.live.map((l) => l.sessionId)).toEqual([away.id]);
    expect(snap.here.sort()).toEqual([here.id, sub.id].sort());
  });

  it("finds a chat by id for actions", async () => {
    const home = tmp();
    const s = writeSession(home, "/code/shop", (c) => [L.user(c, "a")]);
    const svc = new ChatsService(home, { platform: "linux", isAlive: () => true });
    await svc.snapshot([]);
    expect(svc.get(s.id)?.cwd).toBe("/code/shop");
    expect(svc.get("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });

  it("does not count a sibling folder with a shared prefix as this folder", async () => {
    const home = tmp();
    writeSession(home, "/code/shop-old", (c) => [L.user(c, "a")]);
    const svc = new ChatsService(home, { platform: "linux", isAlive: () => true });
    expect((await svc.snapshot(["/code/shop"])).here).toEqual([]);
  });
});
