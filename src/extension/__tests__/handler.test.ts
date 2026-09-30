import { describe, expect, it } from "vitest";
import type { Session } from "../../features/chats/types";
import type { QuotaResult } from "../../features/usage/quotaInstall";
import { createHandler } from "../handler";

const ID = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const S = { id: ID, cwd: "/code/shop", project: "shop" } as Session;

function setup(opts: { known?: boolean; quota?: QuotaResult; recap?: string | null } = {}) {
  const log: string[] = [];
  const handle = createHandler({
    getSession: (id) => ((opts.known ?? true) && id === ID ? S : undefined),
    opener: {
      continueChat: async (s) => void log.push(`chat ${s.id}`),
      continueInTerminal: async (s, o) => void log.push(`${o?.fork ? "fork" : "terminal"} ${s.id}`),
      copyResume: async (s) => void log.push(`copy ${s.id}`),
      newChat: async () => void log.push("new chat"),
    },
    state: {
      setPin: async (id, on) => void log.push(`pin ${id} ${on}`),
      setRename: async (id, t) => void log.push(`rename ${id} ${t}`),
      setTags: async (id, t) => void log.push(`tags ${id} ${t.join(",")}`),
    },
    quota: {
      enable: async () => {
        log.push("quota on");
        return opts.quota ?? { ok: true };
      },
      disable: async () => {
        log.push("quota off");
        return { ok: true };
      },
    },
    recapMarkdown: () => (opts.recap === undefined ? "# My week" : opts.recap),
    copy: async (t) => void log.push(`clipboard ${t}`),
    saveImage: async (d) => void log.push(`save ${d.slice(0, 22)}`),
    refresh: async () => void log.push("refresh"),
    setTab: (t) => void log.push(`tab ${t}`),
    isKnownLink: (u) => u === "https://github.com/a/b/pull/1",
    openLink: async (u) => void log.push(`link ${u}`),
    info: (m) => void log.push(`info ${m}`),
    warn: (m) => void log.push(`warn ${m}`),
  });
  return { handle, log };
}

describe("createHandler", () => {
  it("routes each valid chat message to its action", async () => {
    const { handle, log } = setup();
    await handle({ type: "ready" });
    await handle({ type: "openChat", id: ID });
    await handle({ type: "openTerminal", id: ID });
    await handle({ type: "copyResume", id: ID });
    await handle({ type: "pin", id: ID, on: true });
    await handle({ type: "rename", id: ID, title: "New" });
    await handle({ type: "openLink", url: "https://github.com/a/b/pull/1" });
    await handle({ type: "newChat" });
    await handle({ type: "forkChat", id: ID });
    await handle({ type: "tags", id: ID, tags: ["bug", "release"] });
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
      "new chat",
      `fork ${ID}`,
      `tags ${ID} bug,release`,
      "refresh",
    ]);
  });

  it("only tags or renames chats that exist", async () => {
    const { handle, log } = setup({ known: false });
    await handle({ type: "tags", id: ID, tags: ["x"] });
    await handle({ type: "rename", id: ID, title: "x" });
    expect(log.filter((l) => l.startsWith("tags") || l.startsWith("rename"))).toEqual([]);
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
    const { handle, log } = setup({ known: false });
    await handle({ type: "openChat", id: ID });
    expect(log).toEqual(["warn This chat is no longer on disk. Refreshing the list.", "refresh"]);
  });

  it("turns plan limits on and off, then refreshes", async () => {
    const { handle, log } = setup();
    await handle({ type: "quota", on: true });
    await handle({ type: "quota", on: false });
    expect(log).toEqual(["quota on", "refresh", "quota off", "refresh"]);
  });

  it("explains when plan limits need Node.js", async () => {
    const { handle, log } = setup({ quota: { ok: false, reason: "no-node" } });
    await handle({ type: "quota", on: true });
    expect(log[1]).toMatch(/needs Node\.js/);
  });

  it("stays quiet when the person cancelled (or the reason was already shown)", async () => {
    const { handle, log } = setup({ quota: { ok: false, reason: "not-applied" } });
    await handle({ type: "quota", on: true });
    expect(log).toEqual(["quota on", "refresh"]);
  });

  it("reports an unexpected failure instead of doing nothing", async () => {
    const { handle, log } = setup();
    const h = createHandler({
      getSession: () => undefined,
      opener: {} as never,
      state: {} as never,
      quota: {
        enable: async () => {
          throw new Error("EPERM: settings.json is read-only");
        },
        disable: async () => ({ ok: true }),
      },
      recapMarkdown: () => null,
      copy: async () => {},
      saveImage: async () => {},
      refresh: async () => void log.push("refresh"),
      setTab: () => {},
      isKnownLink: () => false,
      openLink: async () => {},
      info: () => {},
      warn: (m) => void log.push(`warn ${m}`),
    });
    void handle;
    await h({ type: "quota", on: true });
    expect(log).toEqual([
      "warn Orbit couldn't change plan limits: EPERM: settings.json is read-only",
      "refresh",
    ]);
  });

  it("remembers which tab is open and refreshes for it", async () => {
    const { handle, log } = setup();
    await handle({ type: "tab", tab: "setup" });
    expect(log).toEqual(["tab setup", "refresh"]);
  });

  it("copies the weekly recap as Markdown", async () => {
    const { handle, log } = setup();
    await handle({ type: "copyRecap" });
    expect(log).toEqual(["clipboard # My week", "info Recap copied as Markdown."]);
  });

  it("saves the recap image the view rendered", async () => {
    const { handle, log } = setup();
    await handle({ type: "saveRecapImage", dataUrl: "data:image/png;base64,iVBORw0KGgo=" });
    expect(log).toEqual(["save data:image/png;base64,"]);
  });
});
