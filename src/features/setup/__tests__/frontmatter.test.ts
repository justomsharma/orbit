import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../frontmatter";

describe("parseFrontmatter", () => {
  it("returns the whole text as body when there is no frontmatter", () => {
    expect(parseFrontmatter("# Title\nhello\n")).toEqual({
      data: {},
      body: "# Title\nhello\n",
      error: null,
    });
  });

  it("does not treat a later --- line as frontmatter", () => {
    const text = "intro\n---\nname: x\n---\n";
    expect(parseFrontmatter(text)).toEqual({ data: {}, body: text, error: null });
  });

  it("parses key/value pairs and returns the body after the closing line", () => {
    const r = parseFrontmatter("---\nname: review\ndescription: Checks a diff\n---\nBody line\n");
    expect(r).toEqual({
      data: { name: "review", description: "Checks a diff" },
      body: "Body line\n",
      error: null,
    });
  });

  it("allows a UTF-8 BOM and CRLF line endings", () => {
    const r = parseFrontmatter("\uFEFF---\r\nname: a\r\n---\r\nbody\r\n");
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ name: "a" });
    expect(r.body).toBe("body\r\n");
  });

  it("reads arrays and booleans", () => {
    const r = parseFrontmatter(
      "---\ntools:\n  - Read\n  - Grep\nuser-invocable: false\ndisable-model-invocation: true\n---\n",
    );
    expect(r.data).toEqual({
      tools: ["Read", "Grep"],
      "user-invocable": false,
      "disable-model-invocation": true,
    });
    expect(r.body).toBe("");
  });

  it("treats empty frontmatter as no data", () => {
    expect(parseFrontmatter("---\n---\nbody")).toEqual({ data: {}, body: "body", error: null });
  });

  it("reports frontmatter that is never closed", () => {
    const r = parseFrontmatter("---\nname: a\nbody without end\n");
    expect(r.error).toBe("Frontmatter is not closed");
    expect(r.data).toEqual({});
  });

  it("reports bad YAML without throwing", () => {
    const r = parseFrontmatter('---\nname: "unclosed\ndescription: x\n---\nbody\n');
    expect(r.error).toMatch(/^Frontmatter is not valid YAML/);
    expect(r.data).toEqual({});
    expect(r.body).toBe("body\n");
  });

  it("reports YAML that is not a set of keys", () => {
    expect(parseFrontmatter("---\n- a\n- b\n---\n").error).toBe(
      "Frontmatter should be a list of key: value pairs",
    );
    expect(parseFrontmatter("---\njust text\n---\n").error).toBe(
      "Frontmatter should be a list of key: value pairs",
    );
  });

  it("reads `[a] [b]` values that are not valid YAML as plain text", () => {
    const r = parseFrontmatter("---\nargument-hint: [pr] [priority]\ndescription: d\n---\n");
    expect(r).toMatchObject({
      data: { "argument-hint": "[pr] [priority]", description: "d" },
      error: null,
    });
  });

  it("reads a one-line description with ': ' in it as text, as Claude does", () => {
    const r = parseFrontmatter(
      '---\nname: x\ndescription: Become "a guy" — persona: ideas, rules, naming.\nuser-invocable: false\n---\n',
    );
    expect(r).toMatchObject({
      data: {
        name: "x",
        description: 'Become "a guy" — persona: ideas, rules, naming.',
        "user-invocable": false,
      },
      error: null,
    });
  });

  it("still reports frontmatter that is really broken", () => {
    expect(parseFrontmatter("---\nname: [unclosed\n  - x: : :\n---\n").error).toMatch(
      /not valid YAML/,
    );
  });

  it("tolerates duplicate keys (last one wins)", () => {
    const r = parseFrontmatter("---\nname: a\nname: b\n---\n");
    expect(r.error).toBeNull();
    expect(r.data.name).toBe("b");
  });
});
