import { describe, expect, it } from "vitest";
import {
  hookFormError,
  itemFormError,
  mcpFormError,
  needsCmd,
  splitCommand,
  windowsLaunch,
} from "../validate";

describe("splitCommand", () => {
  it("splits on spaces", () => {
    expect(splitCommand("npx -y @modelcontextprotocol/server-github")).toEqual([
      "npx",
      "-y",
      "@modelcontextprotocol/server-github",
    ]);
  });

  it("keeps quoted parts together, including Windows paths with spaces", () => {
    expect(
      splitCommand('"C:\\Users\\Ana Maria\\bin\\srv.exe" --root "C:\\my files" x'),
    ).toEqual(["C:\\Users\\Ana Maria\\bin\\srv.exe", "--root", "C:\\my files", "x"]);
    expect(splitCommand("node 'a b.js' --name=\"x y\"")).toEqual(["node", "a b.js", "--name=x y"]);
  });

  it("returns nothing for blank input and null for an unclosed quote", () => {
    expect(splitCommand("   ")).toEqual([]);
    expect(splitCommand('node "a.js')).toBeNull();
  });
});

describe("mcpFormError", () => {
  const ok = { name: "github", transport: "stdio" as const, command: "npx -y x", url: "" };

  it("accepts a valid server", () => {
    expect(mcpFormError(ok)).toBeNull();
    expect(
      mcpFormError({ ...ok, transport: "http", command: "", url: "http://localhost:3000/mcp" }),
    ).toBeNull();
  });

  it.each([
    [{ name: "" }, /name/i],
    [{ name: "my server" }, /letters, numbers/],
    [{ name: "x".repeat(65) }, /letters, numbers/],
    [{ command: "  " }, /command/i],
    [{ command: 'node "a.js' }, /quote/],
    [{ transport: "http" as const, url: "mcp.example.com" }, /http:\/\/ or https:\/\//],
    [{ transport: "sse" as const, url: "ftp://x" }, /http:\/\/ or https:\/\//],
  ])("explains %o", (over, msg) => {
    expect(mcpFormError({ ...ok, ...over })).toMatch(msg);
  });
});

describe("hookFormError / itemFormError", () => {
  it("needs a command for a hook, within the length Orbit accepts", () => {
    expect(hookFormError({ command: "./lint.sh", matcher: "" })).toBeNull();
    expect(hookFormError({ command: " ", matcher: "" })).toMatch(/command/i);
    expect(hookFormError({ command: "x".repeat(2001), matcher: "" })).toMatch(/too long/);
    expect(hookFormError({ command: "x", matcher: "y".repeat(201) })).toMatch(/too long/);
  });

  it("needs a lowercase name and a description for a new skill, agent or command", () => {
    expect(itemFormError({ name: "triage", description: "Triage issues" })).toBeNull();
    expect(itemFormError({ name: "", description: "x" })).toMatch(/name/i);
    expect(itemFormError({ name: "x", description: " " })).toMatch(/description/i);
    expect(itemFormError({ name: "x", description: "d".repeat(501) })).toMatch(/too long/);
  });
});

describe("needsCmd", () => {
  it("is true only for script shims, never for cmd itself or real programs", () => {
    expect(["npx", "NPM", "yarn", "run.CMD", "a/b/tool.bat"].every(needsCmd)).toBe(true);
    expect(["cmd", "node", "srv.exe", "python"].some(needsCmd)).toBe(false);
  });
});

describe("windowsLaunch", () => {
  it("wraps npx and other script launchers in cmd /c, as Claude Code's docs say", () => {
    expect(windowsLaunch("npx", ["-y", "x"])).toEqual({
      command: "cmd",
      args: ["/c", "npx", "-y", "x"],
    });
    expect(windowsLaunch("pnpm", ["dlx", "x"]).command).toBe("cmd");
    expect(windowsLaunch("C:\\tools\\run.cmd", []).args).toEqual(["/c", "C:\\tools\\run.cmd"]);
  });

  it("leaves real programs and already-wrapped commands alone", () => {
    expect(windowsLaunch("node", ["s.js"])).toEqual({ command: "node", args: ["s.js"] });
    expect(windowsLaunch("cmd", ["/c", "npx", "x"])).toEqual({
      command: "cmd",
      args: ["/c", "npx", "x"],
    });
    expect(windowsLaunch("C:\\bin\\srv.exe", [])).toEqual({
      command: "C:\\bin\\srv.exe",
      args: [],
    });
  });
});
