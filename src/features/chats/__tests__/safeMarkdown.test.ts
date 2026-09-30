import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { describe, expect, it } from "vitest";
import { safeMarkdown } from "../transcript";

// The parser VS Code's Markdown preview uses, with raw HTML allowed as the preview does.
const md = new MarkdownIt({ html: true, linkify: false });

const DANGER = new Set(["html_inline", "html_block", "image", "link_open"]);

function dangerous(src: string): string[] {
  const found: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (DANGER.has(t.type)) found.push(`${t.type}: ${t.content || t.attrGet("href") || ""}`);
      if (t.children) walk(t.children);
    }
  };
  walk(md.parse(src, {}));
  return found;
}

/** What the preview shows as text (code included), with markup stripped. */
function shownText(src: string): string {
  const out: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (
        t.type === "text" ||
        t.type === "code_inline" ||
        t.type === "fence" ||
        t.type === "code_block"
      )
        out.push(t.content);
      if (t.type === "softbreak" || t.type === "hardbreak") out.push("\n");
      if (t.children) walk(t.children);
    }
  };
  walk(md.parse(src, {}));
  return out.join("");
}

const ATTACKS = [
  '<img src="https://tracker.example/p.png">',
  "![badge](https://img.shields.io/x.svg)",
  "[run](command:workbench.action.terminal.new)",
  "[click]\n\n[click]: command:workbench.action.terminal.new",
  "[y][x]\n\n[x]: vscode://anthropic.claude-code/open?prompt=rm",
  "![a][b]\n\n[b]: https://tracker.example/i.png",
  "<https://example.com>",
  "<script>alert(1)</script>",
  "&lt;img src=x&gt; &#60;b&#62;",
  "``` x`y\n<img src=https://a>\n```",
  "\t```\n<img src=https://b>\n````",
  "`` <img src=https://c> ```",
  "a `b\nc` <img src=https://d> `d`",
  '```markdown\n# Readme\n```bash\nnpm i\n```\n<img src="https://img.shields.io/y">\n```',
  "~~~\n<img src=https://e>\n~~~~~~",
  "    <img src=https://f>",
  "You\n---\nsneaky heading",
  "## You\nnot a turn",
  "<div>\n\n*x*\n\n</div>",
  "[a](<command:x>)",
  "\\<img src=https://g>",
  "*[x](command:y)*",
  "> quote [x](command:z)",
  "- item ![i](https://h.png)",
  "1. <img src=https://i>",
  "| a | <img src=https://j> |\n|---|---|",
];

describe("safeMarkdown: nothing in a chat can become HTML, an image or a link", () => {
  it.each(ATTACKS)("neutralises %j", (attack) => {
    expect(dangerous(safeMarkdown(attack))).toEqual([]);
  });

  it("holds for random mixes of the attacks", () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const joins = ["\n", "\n\n", " ", "", "\n```\n", "`", "\n    "];
    for (let n = 0; n < 400; n++) {
      const parts = Array.from({ length: 2 + Math.floor(rnd() * 4) }, () => {
        const a = ATTACKS[Math.floor(rnd() * ATTACKS.length)]!;
        return a + joins[Math.floor(rnd() * joins.length)]!;
      });
      const text = parts.join("");
      expect(dangerous(safeMarkdown(text)), text).toEqual([]);
    }
  });
});

describe("safeMarkdown: what people wrote still reads as written", () => {
  it("shows HTML-looking text and punctuation exactly", () => {
    const text = "Use <Button onClick={go}> and List<T>, see [docs](x) & *not bold* #1";
    expect(shownText(safeMarkdown(text))).toBe(text);
  });

  it("keeps line breaks and indentation", () => {
    const text = "first line\nsecond line\n    indented";
    expect(shownText(safeMarkdown(text))).toBe("first line\nsecond line\n    indented");
  });

  it("keeps code blocks as code, with their content untouched", () => {
    const text = "Here:\n```ts\nconst a = 1 < 2;\n```\nDone.";
    const tokens = md.parse(safeMarkdown(text), {});
    const fence = tokens.find((t) => t.type === "fence");
    expect(fence?.content).toBe("const a = 1 < 2;\n");
    expect(fence?.info).toBe("ts");
  });

  it("keeps a code block that contains its own fences whole", () => {
    const text = "```markdown\n# Readme\n```bash\nnpm i\n```\n<img src=x>\n```";
    const fences = md.parse(safeMarkdown(text), {}).filter((t) => t.type === "fence");
    expect(fences.map((f) => f.content).join("")).toContain("<img src=x>");
  });
});
