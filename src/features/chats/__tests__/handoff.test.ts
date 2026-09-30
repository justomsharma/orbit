import { describe, expect, it } from "vitest";
import { chatUri, pickClaudePath, resumeCommand, terminalOptions } from "../handoff";

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
    });
  });

  it("refuses a hostile session id", () => {
    expect(() => terminalOptions("--dangerously-skip-permissions", "/x", "/bin/claude")).toThrow();
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

  it("falls back to the first hit, and to null when nothing is found", () => {
    expect(pickClaudePath(["C:\\npm\\claude.cmd"], "win32")).toBe("C:\\npm\\claude.cmd");
    expect(pickClaudePath(["/usr/local/bin/claude"], "linux")).toBe("/usr/local/bin/claude");
    expect(pickClaudePath([], "linux")).toBeNull();
    expect(pickClaudePath(["", "  "], "linux")).toBeNull();
  });
});
