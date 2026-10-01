import { describe, expect, it } from "vitest";
import type { AccountSnapshot, SavedAccount } from "../../features/account/accounts";
import { type AccountHandlerDeps, handleAccount } from "../accountHandler";

const saved = (id: string, email: string): SavedAccount => ({
  id,
  name: email.split("@")[0]!,
  email,
  plan: "Pro",
  organization: null,
  savedAt: 1,
});

function setup(
  opts: {
    current?: string | null;
    saved?: SavedAccount[];
    answer?: string;
    pick?: string;
    running?: number;
  } = {},
) {
  const log: string[] = [];
  const list = opts.saved ?? [saved("a", "ana@x.com"), saved("b", "bo@x.com")];
  const snap = (): AccountSnapshot => ({
    profile:
      opts.current === null
        ? null
        : {
            id: opts.current ?? "a",
            name: "ana",
            email: opts.current === "c" ? "cy@x.com" : "ana@x.com",
            organization: null,
            role: null,
            plan: "Pro",
            since: null,
          },
    saved: list,
    canSwitch: true,
  });
  const d: AccountHandlerDeps = {
    accounts: {
      snapshot: async () => snap(),
      saveCurrent: async () => {
        log.push("save");
        return "ana";
      },
      switchTo: async (id) => {
        log.push(`switch ${id}`);
        return list.find((a) => a.id === id)!;
      },
      remove: async (id) => void log.push(`remove ${id}`),
    },
    runClaude: async (args) => void log.push(`claude ${args.join(" ")}`),
    ask: async (message, detail, ...actions) => {
      log.push(`ask ${message} | ${detail} [${actions.join("|")}]`);
      return opts.answer;
    },
    pick: async (_title, items) => {
      log.push(`pick ${items.map((i) => i.label).join(", ")}`);
      return opts.pick;
    },
    running: () => opts.running ?? 0,
    info: (m) => void log.push(`info ${m}`),
    warn: (m) => void log.push(`warn ${m}`),
    refresh: async () => void log.push("refresh"),
  };
  return { log, handle: (m: object) => handleAccount(m, d) };
}

describe("handleAccount", () => {
  it("ignores messages that aren't about accounts", async () => {
    const { handle, log } = setup();
    expect(await handle({ type: "newChat" })).toBe(false);
    expect(log).toEqual([]);
  });

  it("won't switch while chats are running (they could sign the old account back in)", async () => {
    const busy = setup({ running: 2, answer: "Switch" });
    await busy.handle({ type: "account:switch", id: "b" });
    expect(busy.log[0]).toMatch(/^warn .*2 chats are running/);
    expect(busy.log).not.toContain("switch b");
  });

  it("switches only after asking", async () => {
    const no = setup();
    await no.handle({ type: "account:switch", id: "b" });
    expect(no.log[0]).toMatch(/^ask Switch Claude Code to bo@x.com\?/);
    expect(no.log).not.toContain("switch b");

    const yes = setup({ answer: "Switch" });
    await yes.handle({ type: "account:switch", id: "b" });
    expect(yes.log).toContain("switch b");
    expect(yes.log.some((l) => l.startsWith("info Switched to bo@x.com"))).toBe(true);
  });

  it("says when the account is already in use, instead of switching", async () => {
    const { handle, log } = setup({ answer: "Switch" });
    await handle({ type: "account:switch", id: "a" });
    expect(log[0]).toMatch(/already using ana@x.com/);
  });

  it("offers to save an unsaved account before logging in with another one", async () => {
    const { handle, log } = setup({ current: "c", answer: "Save and log in" });
    await handle({ type: "account:login" });
    expect(log[0]).toMatch(/^ask Save cy@x.com before logging in/);
    expect(log.slice(1, 4)).toEqual([
      "save",
      "info Saved ana. Switch back to it any time from Account, without logging in.",
      "claude auth login",
    ]);
  });

  it("logs out with Claude's own command, only when confirmed", async () => {
    const no = setup();
    await no.handle({ type: "account:logout" });
    expect(no.log).not.toContain("claude auth logout");
    const yes = setup({ answer: "Log out" });
    await yes.handle({ type: "account:logout" });
    expect(yes.log).toContain("claude auth logout");
  });

  it("forgets a saved account after asking", async () => {
    const { handle, log } = setup({ answer: "Forget" });
    await handle({ type: "account:remove", id: "b" });
    expect(log).toContain("remove b");
  });

  it("lists saved accounts first in the switcher, then log in", async () => {
    const { handle, log } = setup({ pick: "\0login" });
    await handle({ type: "account:pick" });
    expect(log[0]).toBe("pick $(check) ana, $(account) bo, $(sign-in) Log in with another account");
    expect(log).toContain("claude auth login");
  });

  it("refuses a malformed account id", async () => {
    const { handle } = setup();
    expect(await handle({ type: "account:switch", id: "../../etc" })).toBe(false);
  });
});
