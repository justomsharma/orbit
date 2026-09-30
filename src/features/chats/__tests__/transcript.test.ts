import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Ctx, L, writeSession } from "../../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { safeMarkdown, transcriptMarkdown } from "../transcript";

const tmp = useTmpDir();
const CWD = join("/work", "shop");
const pad = (n: number) => String(n).padStart(2, "0");
/** Local wall-clock time of a line, as the transcript prints it. */
const hm = (l: Record<string, unknown>) => {
  const d = new Date(l.timestamp as string);
  return `*${pad(d.getHours())}:${pad(d.getMinutes())}*`;
};

function write(build: (c: Ctx) => (Record<string, unknown> | string)[]) {
  return writeSession(tmp(), CWD, build).file;
}

describe("transcriptMarkdown", () => {
  it("renders prompts and replies in order, merging one reply's blocks", async () => {
    const lines: Record<string, Record<string, unknown>> = {};
    const file = write((c) => {
      lines.u1 = L.user(c, "Add a dark mode toggle");
      lines.a1 = L.assistant(c, "claude-opus-5-5", undefined, {
        id: "msg_1",
        text: "Sure, here:\n\n```ts\nconst a = 1;\n```",
      });
      lines.u2 = L.user(c, "Thanks!");
      lines.a2 = L.assistant(c, "claude-opus-5-5", undefined, { id: "msg_3", text: "Welcome." });
      return [
        L.mode(c),
        L.meta(c, "<local-command-caveat>Caveat</local-command-caveat>"),
        lines.u1,
        L.assistant(c, "claude-opus-5-5", undefined, {
          id: "msg_1",
          blocks: [{ type: "thinking", thinking: "secret thoughts", signature: "x" }],
        }),
        lines.a1,
        L.toolUse(
          c,
          "Edit",
          { file_path: join(CWD, "src", "a.ts"), old_string: "a" },
          { id: "msg_1" },
        ),
        L.toolResult(c),
        L.assistant(c, "claude-opus-5-5", undefined, { id: "msg_2", text: "All done." }),
        lines.u2,
        lines.a2,
      ];
    });
    const md = await transcriptMarkdown(file, { title: "Dark mode" });
    const expected = [
      "# Dark mode",
      "## You",
      hm(lines.u1!),
      "Add a dark mode toggle",
      "## Claude",
      hm(lines.a1!),
      "Sure, here:\n\n```ts\nconst a = 1;\n```",
      `> 🔧 Edit · \`${join("src", "a.ts")}\``,
      "All done.",
      "## You",
      hm(lines.u2!),
      "Thanks!",
      "## Claude",
      hm(lines.a2!),
      "Welcome.",
    ];
    expect(md).toBe(`${expected.join("\n\n")}\n`);
    expect(md).not.toContain("secret thoughts");
    expect(md).not.toContain("Caveat");
    expect(md).not.toContain("tool_result");
  });

  it("shows each tool call as one line with its most useful input", async () => {
    const file = write((c) => [
      L.user(c, "go"),
      L.toolUse(c, "Bash", { command: "npm test\n  -- -u", description: "Run tests" }),
      L.toolUse(c, "Grep", { pattern: "TODO", path: "src" }),
      L.toolUse(c, "WebFetch", { url: "https://example.com/docs", prompt: "read" }),
      L.toolUse(c, "Agent", { description: "Find the bug", prompt: "long…" }),
      L.toolUse(c, "Read", { file_path: join("/elsewhere", "x.ts") }),
      L.toolUse(c, "TodoWrite", { todos: [] }),
      L.toolUse(c, "Write", { file_path: join(CWD, "a-very-long-file-name-indeed.ts") }),
    ]);
    const md = await transcriptMarkdown(file, { title: "T", maxToolChars: 20 });
    const tools = md.split("\n").filter((l) => l.startsWith("> 🔧"));
    expect(tools).toEqual([
      "> 🔧 Bash · `npm test -- -u`",
      "> 🔧 Grep · `src`",
      "> 🔧 WebFetch · `https://example.com…`",
      "> 🔧 Agent · `Find the bug`",
      `> 🔧 Read · \`${join("/elsewhere", "x.ts")}\``,
      "> 🔧 TodoWrite",
      "> 🔧 Write · `a-very-long-file-na…`",
    ]);
  });

  it("notes images and slash commands, and skips command output and reminders", async () => {
    const file = write((c) => [
      L.user(
        c,
        "<command-name>/review</command-name>\n  <command-message>review</command-message>\n  <command-args>12</command-args>",
      ),
      L.user(c, "<local-command-stdout>Reviewed</local-command-stdout>"),
      L.assistant(c),
      L.userBlocks(c, "Look at this"),
      L.user(c, "<system-reminder>be nice</system-reminder>"),
    ]);
    const md = await transcriptMarkdown(file, { title: "T" });
    const body = md.split("\n").filter((l) => l && !l.startsWith("*") && !l.startsWith("#"));
    expect(body).toEqual(["> /review 12", "Done.", "Look at this", "> 🖼 image"]);
  });

  it("leaves out subagent (sidechain) lines", async () => {
    const file = write((c) => [
      L.user(c, "main prompt"),
      { ...L.user(c, "subagent prompt"), isSidechain: true },
      L.assistant(c, "claude-opus-5-5", undefined, { sidechain: true, text: "subagent reply" }),
      L.assistant(c, "claude-opus-5-5", undefined, { text: "main reply" }),
    ]);
    const md = await transcriptMarkdown(file, { title: "T" });
    expect(md).toContain("main prompt");
    expect(md).toContain("main reply");
    expect(md).not.toContain("subagent");
  });

  it("stops after the turn or size limit with a note", async () => {
    const file = write((c) =>
      Array.from({ length: 10 }, (_, i) => [
        L.user(c, `q${i}`),
        L.assistant(c, "m", undefined, { text: `a${i}` }),
      ]).flat(),
    );
    const byTurns = await transcriptMarkdown(file, { title: "T", maxTurns: 3 });
    expect(byTurns).toContain("a0");
    expect(byTurns).toContain("q1");
    expect(byTurns).not.toContain("a1");
    expect(byTurns.trimEnd().endsWith("*(transcript truncated)*")).toBe(true);
    const bySize = await transcriptMarkdown(file, { title: "T", maxBytes: 3000 });
    expect(bySize).not.toContain("q9");
    expect(bySize.trimEnd().endsWith("*(transcript truncated)*")).toBe(true);
    const whole = await transcriptMarkdown(file, { title: "T" });
    expect(whole).toContain("a9");
    expect(whole).not.toContain("truncated");
  });

  it("returns just the title for a missing file, on one line", async () => {
    expect(await transcriptMarkdown(join(tmp(), "no.jsonl"), { title: "Old\nchat" })).toBe(
      "# Old chat\n",
    );
  });
});

describe("safeMarkdown: what people wrote shows as written, and nothing loads from the web", () => {
  it("keeps HTML-looking text as text", () => {
    expect(safeMarkdown("Use <Button onClick={go}> and List<T>")).toBe(
      String.raw`Use \<Button onClick={go}> and List\<T>`,
    );
  });

  it("never lets an image load", () => {
    expect(safeMarkdown("![badge](https://img.shields.io/x.svg) and <img src=https://x>")).toBe(
      String.raw`!\[badge]\(https://img.shields.io/x.svg) and \<img src=https://x>`,
    );
  });

  it("leaves code blocks and inline code exactly as they were", () => {
    const text = ["Run `a <b> ![c]` then:", "```html", "<img src=https://x>", "```", "Done <ok>"];
    expect(safeMarkdown(text.join("\n"))).toBe(
      [...text.slice(0, 4), String.raw`Done \<ok>`].join("\n"),
    );
  });

  it("shows Markdown links as text, so no link in a chat can run a command", () => {
    expect(safeMarkdown("[run](command:workbench.action.terminal.new) or [x](vscode://a/b)")).toBe(
      String.raw`[run]\(command:workbench.action.terminal.new) or [x]\(vscode://a/b)`,
    );
    expect(safeMarkdown("see `[a](command:x)` in code")).toBe("see `[a](command:x)` in code");
  });

  it("keeps a person's '# heading' from breaking the transcript's structure", () => {
    expect(safeMarkdown("## You\n  # not a heading")).toBe(
      [String.raw`\## You`, String.raw`  \# not a heading`].join("\n"),
    );
  });
});

describe("transcriptMarkdown safety", () => {
  it("escapes chat text and hides secrets in tool lines", async () => {
    const file = write((c) => [
      L.user(c, "see ![x](https://tracker.example/p.png)"),
      L.toolUse(c, "Bash", {
        command: "curl -H 'Authorization: Bearer sk-live-abcdef1234567890abcd' x",
      }),
    ]);
    const md = await transcriptMarkdown(file, { title: "<script>" });
    expect(md.startsWith(String.raw`# \<script>`)).toBe(true);
    expect(md).toContain(String.raw`see !\[x]\(https://tracker.example/p.png)`);
    expect(md).not.toContain("sk-live-abcdef1234567890abcd");
  });
});
