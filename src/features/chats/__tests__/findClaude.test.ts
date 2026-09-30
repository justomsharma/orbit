import { describe, expect, it } from "vitest";
import { findClaude } from "../findClaude";

describe("findClaude", () => {
  it("uses `where` on Windows and prefers the native exe", async () => {
    const seen: string[] = [];
    const r = await findClaude({
      platform: "win32",
      home: "C:\\Users\\a",
      run: async (cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`);
        return "C:\\npm\\claude.cmd\r\nC:\\Users\\a\\.local\\bin\\claude.exe\r\n";
      },
      exists: async () => false,
    });
    expect(seen).toEqual(["where claude"]);
    expect(r).toBe("C:\\Users\\a\\.local\\bin\\claude.exe");
  });

  it("uses `which` elsewhere", async () => {
    const r = await findClaude({
      platform: "darwin",
      home: "/Users/a",
      run: async (cmd) => (cmd === "which" ? "/opt/homebrew/bin/claude\n" : ""),
      exists: async () => false,
    });
    expect(r).toBe("/opt/homebrew/bin/claude");
  });

  it("falls back to Claude's standard install locations when not on PATH", async () => {
    const r = await findClaude({
      platform: "linux",
      home: "/home/a",
      run: async () => {
        throw new Error("not found");
      },
      exists: async (p) => p === "/home/a/.local/bin/claude",
    });
    expect(r).toBe("/home/a/.local/bin/claude");
  });

  it("returns null when claude is nowhere", async () => {
    const r = await findClaude({
      platform: "linux",
      home: "/home/a",
      run: async () => "",
      exists: async () => false,
    });
    expect(r).toBeNull();
  });
});
