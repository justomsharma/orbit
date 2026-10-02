import { describe, expect, it } from "vitest";
import { type AgentFields, agentText, copyName, renamedAgent } from "../agentEdit";
import { EditError } from "../edits";
import { parseFrontmatter } from "../frontmatter";

const fields = (over: Partial<AgentFields> = {}): AgentFields => ({
  name: "code-reviewer",
  description: "Reviews code for bugs",
  model: "sonnet",
  tools: ["Read", "Grep"],
  skills: [],
  prompt: "You review code.\n",
  ...over,
});

describe("agentText", () => {
  it("writes a new agent's frontmatter and prompt", () => {
    const out = agentText(null, fields());
    const fm = parseFrontmatter(out);
    expect(fm.data).toEqual({
      name: "code-reviewer",
      description: "Reviews code for bugs",
      model: "sonnet",
      tools: "Read, Grep",
    });
    expect(fm.body).toBe("You review code.\n");
  });

  it("keeps fields the form doesn't know, in their place, and drops emptied ones", () => {
    const before =
      "---\nname: old\ncolor: blue\ndescription: Old\nmodel: opus\ntools: Read\npermissionMode: plan\n---\nOld prompt\n";
    const out = agentText(before, fields({ model: null, tools: [] }));
    expect(out).toBe(
      "---\nname: code-reviewer\ncolor: blue\ndescription: Reviews code for bugs\npermissionMode: plan\n---\nYou review code.\n",
    );
  });

  it("writes skills as a list", () => {
    const fm = parseFrontmatter(agentText(null, fields({ skills: ["release-notes", "deploy"] })));
    expect(fm.data.skills).toEqual(["release-notes", "deploy"]);
  });

  it("refuses a bad name, an empty description or a broken file", () => {
    expect(() => agentText(null, fields({ name: "Code Reviewer" }))).toThrow(EditError);
    expect(() => agentText(null, fields({ description: " " }))).toThrow(/description/);
    expect(() => agentText("---\nname: [oops\n---\nx", fields())).toThrow(/frontmatter/i);
  });

  it("keeps a description with colons and quotes readable", () => {
    const out = agentText(null, fields({ description: 'Use when: "review" is asked' }));
    expect(parseFrontmatter(out).data.description).toBe('Use when: "review" is asked');
  });
});

describe("renamedAgent", () => {
  it("changes only the frontmatter name, never the prompt", () => {
    expect(renamedAgent("---\ncolor: red\nname: a\n---\nname: keep me\n", "b")).toBe(
      "---\ncolor: red\nname: b\n---\nname: keep me\n",
    );
    expect(renamedAgent("---\ncolor: red\n---\nname: keep\n", "b")).toBe(
      "---\nname: b\ncolor: red\n---\nname: keep\n",
    );
  });
});

describe("copyName", () => {
  it("adds -copy, then a number, until the name is free", () => {
    expect(copyName("reviewer", new Set())).toBe("reviewer-copy");
    expect(copyName("reviewer", new Set(["reviewer-copy", "reviewer-copy-2"]))).toBe(
      "reviewer-copy-3",
    );
  });
});
