import { describe, expect, it } from "vitest";
import { reverseJsonEdit } from "../jsonReverse";

const run = (before: unknown, after: unknown, current: unknown) => {
  const undo = reverseJsonEdit(before as Record<string, unknown>, after as Record<string, unknown>);
  const cur = structuredClone(current) as Record<string, unknown>;
  undo(cur);
  return cur;
};

describe("reverseJsonEdit", () => {
  it("puts back a changed value and keeps everything Claude changed since", () => {
    expect(
      run(
        { theme: "light", numStartups: 1 },
        { theme: "dark", numStartups: 1 },
        { theme: "dark", numStartups: 7, tips: true },
      ),
    ).toEqual({ theme: "light", numStartups: 7, tips: true });
  });

  it("removes what Orbit added and restores what it removed, however deep", () => {
    const before = { mcpServers: { a: { command: "x" } }, projects: { p: { history: [1] } } };
    const after = { mcpServers: { b: { command: "y" } }, projects: { p: { history: [1] } } };
    const current = { mcpServers: { b: { command: "y" } }, projects: { p: { history: [1, 2] } } };
    expect(run(before, after, current)).toEqual({
      mcpServers: { a: { command: "x" } },
      projects: { p: { history: [1, 2] } },
    });
  });

  it("removes a whole object Orbit created", () => {
    expect(
      run(
        { model: "opus" },
        { model: "opus", hooks: { Stop: [{ hooks: [] }] } },
        {
          model: "sonnet",
          hooks: { Stop: [{ hooks: [] }] },
        },
      ),
    ).toEqual({ model: "sonnet" });
  });

  it("undoes list edits item by item, keeping items Claude added", () => {
    const before = { permissions: { allow: ["Read", "Bash(ls)"] } };
    const after = { permissions: { allow: ["Read", "Bash(npm test)"] } };
    const current = { permissions: { allow: ["Read", "Bash(npm test)", "Edit"] } };
    expect(run(before, after, current)).toEqual({
      permissions: { allow: ["Read", "Edit", "Bash(ls)"] },
    });
  });

  it("refuses when the same value was changed again since Orbit's edit", () => {
    const undo = reverseJsonEdit({ theme: "light" }, { theme: "dark" });
    expect(() => undo({ theme: "dark-daltonized" })).toThrow(/changed again/);
  });

  it("refuses when a value Orbit added is already gone", () => {
    const undo = reverseJsonEdit({}, { mcpServers: { b: { command: "y" } } });
    expect(() => undo({})).toThrow(/changed again/);
  });

  it("refuses when a value Orbit removed has come back differently", () => {
    const undo = reverseJsonEdit({ mcpServers: { a: { command: "x" } } }, { mcpServers: {} });
    expect(() => undo({ mcpServers: { a: { command: "z" } } })).toThrow(/changed again/);
  });

  it("treats lists of objects as one value", () => {
    const before = { hooks: { Stop: [{ hooks: [{ type: "command", command: "a" }] }] } };
    const after = { hooks: { Stop: [] } };
    expect(run(before, after, { hooks: { Stop: [] } })).toEqual(before);
    const undo = reverseJsonEdit(before, after);
    expect(() => undo({ hooks: { Stop: [{ hooks: [] }] } })).toThrow(/changed again/);
  });

  it("refuses when a parent is no longer an object", () => {
    const undo = reverseJsonEdit({ a: { b: 1 } }, { a: { b: 2 } });
    expect(() => undo({ a: "text" })).toThrow(/changed again/);
  });

  describe("objects Orbit created or removed", () => {
    it("undoes the first rule even after Claude added its own rule to the new list", () => {
      expect(
        run(
          {},
          { permissions: { allow: ["Read"] } },
          { permissions: { allow: ["Read", "Bash(ls)"] } },
        ),
      ).toEqual({ permissions: { allow: ["Bash(ls)"] } });
    });

    it("leaves no empty containers behind when nothing else was added", () => {
      expect(
        run(
          { a: 1 },
          { a: 1, permissions: { allow: ["Read"] } },
          { a: 2, permissions: { allow: ["Read"] } },
        ),
      ).toEqual({ a: 2 });
    });

    it("undoes a folder's first local MCP server while keeping what Claude stored there since", () => {
      const before = { projects: {} };
      const after = { projects: { "C:/x": { mcpServers: { db: { command: "x" } } } } };
      const current = {
        projects: { "C:/x": { mcpServers: { db: { command: "x" } }, history: ["hi"] } },
      };
      expect(run(before, after, current)).toEqual({ projects: { "C:/x": { history: ["hi"] } } });
    });

    it("still refuses when Claude changed the very thing Orbit added", () => {
      const undo = reverseJsonEdit({}, { mcpServers: { db: { command: "x" } } });
      expect(() => undo({ mcpServers: { db: { command: "y" } } })).toThrow(/changed again/);
    });

    it("puts back a removed object whole while its place is still empty", () => {
      const before = { mcpServers: { db: { command: "npx", args: ["db-mcp"] } }, n: 1 };
      const after = { mcpServers: {}, n: 1 };
      expect(run(before, after, { mcpServers: { gh: { url: "u" } }, n: 7 })).toEqual({
        mcpServers: { gh: { url: "u" }, db: { command: "npx", args: ["db-mcp"] } },
        n: 7,
      });
    });

    it("never mixes a removed object into a new one with the same name", () => {
      const undo = reverseJsonEdit(
        { mcpServers: { db: { command: "npx", args: ["db-mcp"] } } },
        { mcpServers: {} },
      );
      expect(() => undo({ mcpServers: { db: { type: "http", url: "https://x" } } })).toThrow(
        /changed again/,
      );
    });
  });

  it("does nothing for an edit that changed nothing", () => {
    expect(run({ a: 1 }, { a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });
});
