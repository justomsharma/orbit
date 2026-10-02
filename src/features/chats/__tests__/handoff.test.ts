import { describe, expect, it } from "vitest";
import {
  chatUri,
  newChatTerminal,
  pickClaudePath,
  promptIsSafeArg,
  resumeCommand,
  terminalOptions,
} from "../handoff";

const ID = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";

describe("chatUri", () => {
  it("builds Anthropic's documented deep link for this editor", () => {
    expect(chatUri("vscode", ID)).toBe(`vscode://anthropic.claude-code/open?session=${ID}`);
    expect(chatUri("cursor", ID)).toBe(`cursor://anthropic.claude-code/open?session=${ID}`);
  });

  it("encodes an optional prompt", () => {
    expect(chatUri("vscode", undefined, "fix it & ship")).toBe(
      "vscode://anthropic.claude-code/open?prompt=fix%20it%20%26%20ship",
    );
  });

  it("refuses anything that is not a session id", () => {
    expect(() => chatUri("vscode", "x&prompt=rm -rf")).toThrow();
  });

  it("refuses an unsafe URI scheme", () => {
    expect(() => chatUri("javascript:alert(1)//", ID)).toThrow();
  });
});

describe("terminalOptions", () => {
  it("runs claude directly with arguments — no shell in between", () => {
    const o = terminalOptions(ID, 'C:\\my "odd" dir', "C:\\bin\\claude.exe");
    expect(o).toEqual({
      name: 'Claude · my "odd" dir',
      shellPath: "C:\\bin\\claude.exe",
      shellArgs: ["--resume", ID],
      cwd: 'C:\\my "odd" dir',
      sessionId: ID,
    });
  });

  it("names the terminal after the chat when it knows the title", () => {
    const named = terminalOptions(ID, "/x", "/bin/claude", {
      title: "Fix the checkout race condition",
    });
    expect(named.name).toBe("Fix the checkout race c…");
    const fork = terminalOptions(ID, "/x", "/bin/claude", { title: "Short", fork: true });
    expect(fork.name).toBe("Fork: Short");
  });

  it("refuses a hostile session id", () => {
    expect(() => terminalOptions("--dangerously-skip-permissions", "/x", "/bin/claude")).toThrow();
  });

  it("forks into a new chat with Claude's own --fork-session flag", () => {
    expect(terminalOptions(ID, "/code/shop", "/bin/claude", { fork: true })).toEqual({
      name: "Claude · shop (new branch)",
      shellPath: "/bin/claude",
      shellArgs: ["--resume", ID, "--fork-session"],
      cwd: "/code/shop",
    });
  });
});

describe("resumeCommand for a fork", () => {
  it("adds --fork-session", () => {
    expect(resumeCommand(ID, "/code/shop", "linux", { fork: true })).toBe(
      `cd '/code/shop' && claude --resume ${ID} --fork-session`,
    );
  });
});

describe("resumeCommand (for the clipboard)", () => {
  it("quotes POSIX paths safely", () => {
    expect(resumeCommand(ID, "/home/ana/it's here", "linux")).toBe(
      `cd '/home/ana/it'\\''s here' && claude --resume ${ID}`,
    );
  });

  it("uses PowerShell syntax on Windows and doubles single quotes", () => {
    expect(resumeCommand(ID, "C:\\Ana's code", "win32")).toBe(
      `Set-Location -LiteralPath 'C:\\Ana''s code'; claude --resume ${ID}`,
    );
  });

  it("doubles the curly quotes PowerShell also treats as single quotes", () => {
    expect(resumeCommand(ID, "C:\\O’Brien‘x", "win32")).toBe(
      `Set-Location -LiteralPath 'C:\\O’’Brien‘‘x'; claude --resume ${ID}`,
    );
  });

  it("omits the cd when there is no folder", () => {
    expect(resumeCommand(ID, "", "darwin")).toBe(`claude --resume ${ID}`);
  });

  it("refuses a hostile session id", () => {
    expect(() => resumeCommand("$(reboot)", "/x", "linux")).toThrow();
  });
});

describe("pickClaudePath", () => {
  it("prefers a native .exe over npm's .cmd shim on Windows", () => {
    expect(
      pickClaudePath(["C:\\npm\\claude.cmd", "C:\\Users\\a\\.local\\bin\\claude.exe"], "win32"),
    ).toBe("C:\\Users\\a\\.local\\bin\\claude.exe");
  });

  it("never picks npm's extensionless POSIX script on Windows (real `where` order)", () => {
    const where = [
      "C:\\Users\\a\\AppData\\Roaming\\npm\\claude",
      "C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd",
    ];
    expect(pickClaudePath(where, "win32")).toBe("C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd");
    expect(pickClaudePath(["C:\\x\\claude", "C:\\x\\claude.ps1"], "win32")).toBeNull();
    expect(pickClaudePath(["C:\\x\\claude.BAT"], "win32")).toBe("C:\\x\\claude.BAT");
  });

  it("falls back to the first hit, and to null when nothing is found", () => {
    expect(pickClaudePath(["C:\\npm\\claude.cmd"], "win32")).toBe("C:\\npm\\claude.cmd");
    expect(pickClaudePath(["/usr/local/bin/claude"], "linux")).toBe("/usr/local/bin/claude");
    expect(pickClaudePath([], "linux")).toBeNull();
    expect(pickClaudePath(["", "  "], "linux")).toBeNull();
  });
});

describe("promptIsSafeArg (a prompt as claude's first message)", () => {
  it("passes plain text to a real executable", () => {
    expect(promptIsSafeArg("Fix the login bug", "/usr/local/bin/claude", "linux")).toBe(true);
    expect(
      promptIsSafeArg("Say hi, then exit", "C:\\Users\\a\\.local\\bin\\claude.exe", "win32"),
    ).toBe(true);
  });

  it("never gives free text to npm's .cmd shim, which cmd.exe would re-parse", () => {
    expect(promptIsSafeArg("Fix it & del *", "C:\\npm\\claude.cmd", "win32")).toBe(false);
  });

  it("keeps prompts that look like options, or span lines on Windows, off the command line", () => {
    expect(promptIsSafeArg("--dangerously-skip-permissions", "/bin/claude", "linux")).toBe(false);
    expect(promptIsSafeArg("  -p hi", "/bin/claude", "linux")).toBe(false);
    expect(promptIsSafeArg("one\ntwo", "C:\\bin\\claude.exe", "win32")).toBe(false);
    expect(promptIsSafeArg("one\ntwo", "/bin/claude", "linux")).toBe(true);
    expect(promptIsSafeArg("", "/bin/claude", "linux")).toBe(false);
  });

  it("builds the terminal with the prompt only when it's safe", () => {
    expect(newChatTerminal("/w", "/bin/claude", "hello", "linux").shellArgs).toEqual(["hello"]);
    expect(newChatTerminal("/w", "C:\\npm\\claude.cmd", "hello", "win32").shellArgs).toEqual([]);
  });
});

describe("promptIsSafeArg on Windows shims", () => {
  it("keeps characters cmd.exe treats specially off the command line, even for an .exe", () => {
    for (const p of ['x" & calc & "', "a | b", "50% off", "hi!", "a^b", "<b>", "a > b"]) {
      expect(promptIsSafeArg(p, "C:\\scoop\\shims\\claude.exe", "win32")).toBe(false);
    }
    expect(promptIsSafeArg("Fix the login bug, then add tests.", "C:\\claude.exe", "win32")).toBe(
      true,
    );
  });
});
