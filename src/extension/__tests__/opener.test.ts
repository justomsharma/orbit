import { describe, expect, it } from "vitest";
import type { Session } from "../../features/chats/types";
import { Opener, type OpenerHost } from "../opener";

const ID = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const session = (cwd: string) => ({ id: ID, cwd, project: "shop" }) as Session;

type Over = Partial<Omit<OpenerHost, "ask">> & { choose?: string };

/** Records every side effect as a readable line; `choose` is the button the person clicks. */
function fakeHost(over: Over = {}) {
  const calls: string[] = [];
  const { choose, ...rest } = over;
  const host: OpenerHost = {
    uriScheme: "vscode",
    platform: "linux",
    claudeExtensionInstalled: () => true,
    workspaceFolders: () => ["/code/shop"],
    findClaude: async () => "/usr/bin/claude",
    pathExists: async () => true,
    openExternal: async (u) => {
      calls.push(`open ${u}`);
      return true;
    },
    createTerminal: (o) => {
      calls.push(`terminal ${o.shellPath} ${o.shellArgs.join(" ")} @${o.cwd}`);
    },
    copy: async (t) => {
      calls.push(`copy ${t}`);
    },
    ask: async (msg, ...actions) => {
      calls.push(`ask ${msg} [${actions.join("|")}]`);
      return choose;
    },
    info: (m) => {
      calls.push(`info ${m}`);
    },
    ...rest,
  };
  return { host, calls };
}

describe("Opener.continueChat", () => {
  it("opens the chat in Claude's panel when it belongs to this workspace", async () => {
    const { host, calls } = fakeHost();
    await new Opener(host).continueChat(session("/code/shop"));
    expect(calls).toEqual([`open vscode://anthropic.claude-code/open?session=${ID}`]);
  });

  it("matches the workspace regardless of Windows path case", async () => {
    const { host, calls } = fakeHost({
      platform: "win32",
      workspaceFolders: () => ["c:\\Code\\Shop"],
    });
    await new Opener(host).continueChat(session("C:\\code\\shop\\"));
    expect(calls[0]).toContain("anthropic.claude-code/open");
  });

  it("offers the terminal when the chat is from another folder", async () => {
    const { host, calls } = fakeHost({ choose: "Continue in terminal" });
    await new Opener(host).continueChat(session("/code/other"));
    expect(calls[0]).toMatch(/^ask .*other.*\[Continue in terminal\|Copy command\]/);
    expect(calls[1]).toBe(`terminal /usr/bin/claude --resume ${ID} @/code/other`);
  });

  it("falls back to the terminal offer when Claude's extension is missing", async () => {
    const { host, calls } = fakeHost({
      claudeExtensionInstalled: () => false,
    });
    await new Opener(host).continueChat(session("/code/shop"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(
      /^ask .*Claude Code extension.*installed or enabled.*\[Continue in terminal\|Install extension\]/,
    );
  });
});

describe("Opener.continueChat (subfolders)", () => {
  it("explains that a chat from a subfolder can't open in Claude's panel", async () => {
    const { host, calls } = fakeHost({ choose: "Continue in terminal" });
    await new Opener(host).continueChat(session("/code/shop/packages/ui"));
    expect(calls[0]).toMatch(
      /^ask .*subfolder.*packages\/ui.*\[Continue in terminal\|Copy command\]/,
    );
    expect(calls[1]).toMatch(/^terminal /);
  });
});

describe("Opener.continueInTerminal", () => {
  it("launches claude as the terminal program", async () => {
    const { host, calls } = fakeHost();
    await new Opener(host).continueInTerminal(session("/code/shop"));
    expect(calls).toEqual([`terminal /usr/bin/claude --resume ${ID} @/code/shop`]);
  });

  it("explains and offers to copy the command when claude is not installed", async () => {
    const { host, calls } = fakeHost({ findClaude: async () => null });
    await new Opener(host).continueInTerminal(session("/code/shop"));
    expect(calls[0]).toMatch(/^ask .*claude.*not found.*\[Copy command\|How to install\]/i);
  });

  it("forks a chat into a new one, keeping the original untouched", async () => {
    const { host, calls } = fakeHost();
    await new Opener(host).continueInTerminal(session("/code/shop"), { fork: true });
    expect(calls).toEqual([`terminal /usr/bin/claude --resume ${ID} --fork-session @/code/shop`]);
  });

  it("refuses when the chat's folder no longer exists", async () => {
    const { host, calls } = fakeHost({ pathExists: async () => false });
    await new Opener(host).continueInTerminal(session("/code/gone"));
    expect(calls).toEqual(["info The folder for this chat no longer exists: /code/gone"]);
  });
});

describe("Orbit's Open chats in: terminal", () => {
  it("continues any chat in a terminal, even one from another folder", async () => {
    const { host, calls } = fakeHost({ openIn: () => "terminal" });
    await new Opener(host).continueChat(session("/code/elsewhere"));
    expect(calls).toEqual([`terminal /usr/bin/claude --resume ${ID} @/code/elsewhere`]);
  });

  it("starts new chats in a terminal with the prompt as the first message", async () => {
    const { host, calls } = fakeHost({ openIn: () => "terminal" });
    await new Opener(host).newChat("Add tests");
    expect(calls).toEqual(["terminal /usr/bin/claude Add tests @/code/shop"]);
  });

  it("falls back to Claude's panel when the claude command is missing", async () => {
    const { host, calls } = fakeHost({ openIn: () => "terminal", findClaude: async () => null });
    await new Opener(host).newChat("Add tests");
    expect(calls).toEqual(["open vscode://anthropic.claude-code/open?prompt=Add%20tests"]);
  });

  it("continues the most recent chat in the folder with --continue", async () => {
    const { host, calls } = fakeHost({ openIn: () => "terminal" });
    await new Opener(host).continueLast();
    expect(calls).toEqual(["terminal /usr/bin/claude --continue @/code/shop"]);
  });
});

describe("Opener.newChat", () => {
  it("opens a fresh chat in Claude's panel", async () => {
    const { host, calls } = fakeHost();
    await new Opener(host).newChat();
    expect(calls).toEqual(["open vscode://anthropic.claude-code/open"]);
  });

  it("starts claude in a terminal in the open folder when the extension is missing", async () => {
    const { host, calls } = fakeHost({ claudeExtensionInstalled: () => false });
    await new Opener(host).newChat();
    expect(calls).toEqual(["terminal /usr/bin/claude  @/code/shop"]);
  });

  it("opens a chat with a prompt typed in (not sent) for Fix with Claude", async () => {
    const { host, calls } = fakeHost();
    await new Opener(host).newChat("Fix my settings.json");
    expect(calls).toEqual([
      "open vscode://anthropic.claude-code/open?prompt=Fix%20my%20settings.json",
    ]);
  });

  it("starts the terminal chat with the prompt as its first message when only the CLI exists", async () => {
    const { host, calls } = fakeHost({ claudeExtensionInstalled: () => false });
    await new Opener(host).newChat("Fix it");
    expect(calls).toEqual(["terminal /usr/bin/claude Fix it @/code/shop"]);
  });

  it("copies a prompt that can't be passed safely (npm's .cmd shim on Windows, or one that looks like a flag)", async () => {
    const win = fakeHost({
      platform: "win32",
      claudeExtensionInstalled: () => false,
      findClaude: async () => "C:\\npm\\claude.cmd",
      workspaceFolders: () => ["C:\\code\\shop"],
    });
    await new Opener(win.host).newChat("Fix it & del *");
    expect(win.calls[0]).toBe("terminal C:\\npm\\claude.cmd  @C:\\code\\shop");
    expect(win.calls[1]).toBe("copy Fix it & del *");
    expect(win.calls[2]).toMatch(/^info .*paste/i);

    const flag = fakeHost({ claudeExtensionInstalled: () => false });
    await new Opener(flag.host).newChat("--dangerously-skip-permissions");
    expect(flag.calls[0]).toBe("terminal /usr/bin/claude  @/code/shop");
    expect(flag.calls[1]).toBe("copy --dangerously-skip-permissions");
  });

  it("explains when neither Claude's extension nor the claude command is available", async () => {
    const { host, calls } = fakeHost({
      claudeExtensionInstalled: () => false,
      findClaude: async () => null,
    });
    await new Opener(host).newChat();
    expect(calls[0]).toMatch(
      /^ask .*Install Claude Code.*\[Install extension\|How to install the CLI\]/,
    );
  });
});

describe("Opener.copyResume", () => {
  it("copies a shell-safe command", async () => {
    const { host, calls } = fakeHost();
    await new Opener(host).copyResume(session("/code/shop"));
    expect(calls[0]).toBe(`copy cd '/code/shop' && claude --resume ${ID}`);
    expect(calls[1]).toMatch(/^info Copied/);
  });
});

describe("Opener.continueLast without a folder", () => {
  it("asks for a folder instead of continuing a chat from VS Code's own folder", async () => {
    const { host, calls } = fakeHost({ workspaceFolders: () => [] });
    await new Opener(host).continueLast();
    expect(calls[0]).toMatch(/^info Open a folder first/);
  });
});
