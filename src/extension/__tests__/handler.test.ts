import { describe, expect, it } from "vitest";
import type { Session } from "../../features/chats/types";
import { createHandler } from "../handler";

const ID = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const S = { id: ID, cwd: "/code/shop", project: "shop" } as Session;

function setup(known = true) {
  const log: string[] = [];
  const handle = createHandler({
    getSession: (id) => (known && id === ID ? S : undefined),
    opener: {
      continueChat: async (s) => void log.push(`chat ${s.id}`),
      continueInTerminal: async (s) => void log.push(`terminal ${s.id}`),
      copyResume: async (s) => void log.push(`copy ${s.id}`),
    },
    state: {
      setPin: async (id, on) => void log.push(`pin ${id} ${on}`),
      setRename: async (id, t) => void log.push(`rename ${id} ${t}`),
    },
    refresh: async () => void log.push("refresh"),
    isKnownLink: (u) => u === "https://github.com/a/b/pull/1",
    openLink: async (u) => void log.push(`link ${u}`),
    warn: (m) => void log.push(`warn ${m}`),
  });
  return { handle, log };
}

describe("createHandler", () => {
  it("routes each valid message to its action", async () => {
    const { handle, log } = setup();
    await handle({ type: "ready" });
    await handle({ type: "openChat", id: ID });
    await handle({ type: "openTerminal", id: ID });
    await handle({ type: "copyResume", id: ID });
    await handle({ type: "pin", id: ID, on: true });
    await handle({ type: "rename", id: ID, title: "New" });
    await handle({ type: "openLink", url: "https://github.com/a/b/pull/1" });
    expect(log).toEqual([
      "refresh",
      `chat ${ID}`,
      `terminal ${ID}`,
      `copy ${ID}`,
      `pin ${ID} true`,
      "refresh",
      `rename ${ID} New`,
      "refresh",
      "link https://github.com/a/b/pull/1",
    ]);
  });

  it("drops malformed messages without acting", async () => {
    const { handle, log } = setup();
    await handle({ type: "openChat", id: "x; rm -rf ~" });
    await handle({ type: "openLink", url: "file:///etc/passwd" });
    await handle("junk");
    expect(log).toEqual([]);
  });

  it("only opens links that appear in the person's chats", async () => {
    const { handle, log } = setup();
    await handle({ type: "openLink", url: "https://evil.example/phish" });
    expect(log).toEqual([]);
  });

  it("tells the person when a chat no longer exists", async () => {
    const { handle, log } = setup(false);
    await handle({ type: "openChat", id: ID });
    expect(log).toEqual(["warn This chat is no longer on disk. Refreshing the list.", "refresh"]);
  });
});
