import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EditError } from "../edits";
import { parseFrontmatter } from "../frontmatter";
import { newItem } from "../templates";

describe("newItem", () => {
  it("creates a skill folder with a SKILL.md Claude can use", () => {
    const r = newItem({
      kind: "skill",
      root: "/h/.claude",
      name: "release-notes",
      description: "Write release notes from merged PRs",
    });
    expect(r.file).toBe(join("/h/.claude", "skills", "release-notes", "SKILL.md"));
    const fm = parseFrontmatter(r.text);
    expect(fm.error).toBeNull();
    expect(fm.data).toMatchObject({
      name: "release-notes",
      description: "Write release notes from merged PRs",
    });
    expect(fm.body.trim().length).toBeGreaterThan(20);
  });

  it("creates an agent and a command in their folders", () => {
    const a = newItem({
      kind: "agent",
      root: "/w/.claude",
      name: "reviewer",
      description: "Reviews diffs",
    });
    expect(a.file).toBe(join("/w/.claude", "agents", "reviewer.md"));
    expect(parseFrontmatter(a.text).data).toMatchObject({
      name: "reviewer",
      description: "Reviews diffs",
    });
    const c = newItem({
      kind: "command",
      root: "/w/.claude",
      name: "ship",
      description: "Ship it",
    });
    expect(c.file).toBe(join("/w/.claude", "commands", "ship.md"));
    expect(parseFrontmatter(c.text).data).toMatchObject({ description: "Ship it" });
  });

  it("quotes descriptions safely in YAML", () => {
    const r = newItem({
      kind: "skill",
      root: "/h",
      name: "x",
      description: 'Use: "quotes" & colons: yes',
    });
    expect(parseFrontmatter(r.text).data.description).toBe('Use: "quotes" & colons: yes');
  });

  it.each(["", "Has Space", "../escape", "a/b", "UPPER", "x".repeat(65)])(
    "refuses the name %p",
    (name) => {
      expect(() => newItem({ kind: "skill", root: "/h", name, description: "d" })).toThrow(
        EditError,
      );
    },
  );

  it("requires a description, which is how Claude decides when to use it", () => {
    expect(() => newItem({ kind: "agent", root: "/h", name: "a", description: " " })).toThrow(
      /description/,
    );
  });
});
