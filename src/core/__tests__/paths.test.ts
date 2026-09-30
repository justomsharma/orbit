import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeHome,
  claudeJsonPath,
  claudeProjectKey,
  findProjectKey,
  normPath,
  projectName,
  samePath,
} from "../paths";

describe("claudeHome", () => {
  it("defaults to ~/.claude", () => {
    expect(claudeHome({}, "/home/ana")).toBe(join("/home/ana", ".claude"));
  });

  it("honours CLAUDE_CONFIG_DIR", () => {
    expect(claudeHome({ CLAUDE_CONFIG_DIR: "/data/claude" }, "/home/ana")).toBe(
      join("/data/claude"),
    );
  });

  it("ignores a blank CLAUDE_CONFIG_DIR", () => {
    expect(claudeHome({ CLAUDE_CONFIG_DIR: "  " }, "/home/ana")).toBe(join("/home/ana", ".claude"));
  });

  it("expands a leading ~ in CLAUDE_CONFIG_DIR", () => {
    expect(claudeHome({ CLAUDE_CONFIG_DIR: "~/alt" }, "/home/ana")).toBe(join("/home/ana", "alt"));
  });
});

describe("claudeJsonPath", () => {
  it("lives in the home dir by default", () => {
    expect(claudeJsonPath({}, "/home/ana")).toBe(join("/home/ana", ".claude.json"));
  });

  it("lives inside CLAUDE_CONFIG_DIR when set", () => {
    expect(claudeJsonPath({ CLAUDE_CONFIG_DIR: "/data/c" }, "/home/ana")).toBe(
      join("/data/c", ".claude.json"),
    );
  });
});

describe("normPath / samePath", () => {
  it("treats Windows drive letter and case as equal", () => {
    expect(samePath("c:\\Code\\App\\", "C:\\code\\app", "win32")).toBe(true);
  });

  it("treats forward and back slashes as equal on Windows", () => {
    expect(samePath("C:/code/app", "C:\\code\\app", "win32")).toBe(true);
  });

  it("is case-sensitive on POSIX", () => {
    expect(samePath("/code/App", "/code/app", "linux")).toBe(false);
  });

  it("strips a trailing separator but keeps a root", () => {
    expect(normPath("/code/app/", "linux")).toBe("/code/app");
    expect(normPath("/", "linux")).toBe("/");
    expect(normPath("C:\\", "win32")).toBe("c:\\");
  });
});

describe("projectName", () => {
  it("returns the last folder for POSIX and Windows paths", () => {
    expect(projectName("/home/ana/code/shop")).toBe("shop");
    expect(projectName("C:\\work\\jt-services")).toBe("jt-services");
    expect(projectName("C:\\work\\jt-services\\")).toBe("jt-services");
  });

  it("falls back sensibly for a root or empty path", () => {
    expect(projectName("/")).toBe("/");
    expect(projectName("")).toBe("Unknown project");
  });
});

describe("claudeProjectKey / findProjectKey", () => {
  it("writes Windows folders the way Claude Code keys them in ~/.claude.json", () => {
    expect(claudeProjectKey(String.raw`c:\Learnings\x\ `.trim(), "win32")).toBe("C:/Learnings/x");
    expect(claudeProjectKey(String.raw`C:\ `.trim(), "win32")).toBe("C:/");
    expect(claudeProjectKey("/home/ana/shop/", "linux")).toBe("/home/ana/shop");
  });

  it("prefers Claude's own key over another spelling of the same folder", () => {
    const keys = [String.raw`c:\Learnings\x`, "C:/Learnings/x", "C:/Learnings/y"];
    expect(findProjectKey(keys, String.raw`c:\learnings\X`, "win32")).toBe("C:/Learnings/x");
  });

  it("falls back to any spelling of the same folder, else null", () => {
    const vscodeStyle = String.raw`c:\Learnings\x`;
    expect(findProjectKey([vscodeStyle], String.raw`C:\Learnings\x`, "win32")).toBe(vscodeStyle);
    expect(findProjectKey(["C:/other"], String.raw`C:\Learnings\x`, "win32")).toBeNull();
    expect(findProjectKey(["/code/App"], "/code/app", "linux")).toBeNull();
  });
});
