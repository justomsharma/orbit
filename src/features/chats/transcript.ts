import { relative } from "node:path";
import { MiB } from "../../core/fsSafe";
import { type JsonObject, str } from "../../core/jsonl";
import { parseJsonLine, streamLines } from "../../core/lines";
import { isInside } from "../../core/paths";
import { redactText } from "../setup/redact";
import { type AssistantPart, assistantParts, type UserPart, userParts } from "./messages";

export interface TranscriptOptions {
  title: string;
  /** Longest tool input shown on a tool line (default 300). */
  maxToolChars?: number;
  /** Stop after reading this much of the transcript (default 20 MB, counted in characters). */
  maxBytes?: number;
  /** Stop after this many "You"/"Claude" sections (default 5000). */
  maxTurns?: number;
}

/** Tool inputs worth showing, most useful first. */
const TOOL_FIELDS = [
  "file_path",
  "notebook_path",
  "path",
  "command",
  "pattern",
  "url",
  "query",
  "description",
];
const PATH_FIELDS = new Set(["file_path", "notebook_path", "path"]);

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const pad = (n: number) => String(n).padStart(2, "0");

function timeLine(l: JsonObject): string | null {
  const t = Date.parse(str(l.timestamp) ?? "");
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `*${pad(d.getHours())}:${pad(d.getMinutes())}*`;
}

/** Plain text shown as inline code, whatever backticks it contains. */
function codeSpan(s: string): string {
  const longest = Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${ticks}${pad}${s}${pad}${ticks}`;
}

/**
 * Every ASCII punctuation mark escaped: Markdown then shows the text exactly as
 * written and can make nothing of it — no HTML, image, link, heading, list or code.
 */
const escapeText = (s: string) => s.replace(/[!-/:-@[-`{-~]/g, "\\$&");

/** One line of prose: escaped, with its indentation kept as non-breaking spaces. */
function proseLine(line: string): string {
  const indent = line.match(/^[ \t]*/)![0];
  const nbsp = indent.replace(/\t/g, "    ").replace(/ /g, " ");
  return nbsp + escapeText(line.slice(indent.length));
}

/** Code as a fenced block Orbit writes itself: longer than any backtick run inside, so it can't end early. */
function codeBlock(lines: string[], info: string): string {
  const body = lines.join("\n");
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const lang = info.match(/^[\w+#.-]{1,30}/)?.[0] ?? "";
  return `${fence}${lang}\n${body}\n${fence}`;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Chat text as Markdown that shows exactly what was written, and nothing else:
 * no raw HTML, no images (the preview would fetch them), no links, no headings.
 *
 * Safe by construction: code blocks are re-fenced by Orbit so their content is
 * never interpreted, and everything else has every punctuation mark escaped.
 * Spotting a code block wrongly can only change how text looks, never let it run.
 */
export function safeMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const endPara = () => {
    // Line breaks inside a paragraph stay line breaks (a trailing "\" is a hard break).
    if (para.length) out.push(para.join("\\\n"));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const open = line.match(FENCE);
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      endPara();
      const mark = open[1]!;
      const body: string[] = [];
      // People nest fences ("```markdown" holding a "```bash" block): keep them together.
      let depth = 0;
      for (i++; i < lines.length; i++) {
        const m = lines[i]!.match(FENCE);
        if (m && m[1]![0] === mark[0] && m[1]!.length >= mark.length) {
          if (m[2]!.trim()) depth++;
          else if (depth === 0) break;
          else depth--;
        }
        body.push(lines[i]!);
      }
      out.push(codeBlock(body, open[2]!.trim()));
      continue;
    }
    if (line.trim() === "") endPara();
    else para.push(proseLine(line));
  }
  endPara();
  return out.join("\n\n");
}

function toolLine(p: { name: string; input: JsonObject }, cwd: string, max: number): string {
  for (const f of TOOL_FIELDS) {
    let v = str(p.input[f]);
    if (!v?.trim()) continue;
    if (PATH_FIELDS.has(f) && cwd && isInside(cwd, v)) v = relative(cwd, v) || ".";
    // Commands often carry tokens; the transcript may be exported and shared.
    return `> 🔧 ${escapeText(p.name)} · ${codeSpan(clip(oneLine(redactText(v)), max))}`;
  }
  return `> 🔧 ${escapeText(p.name)}`;
}

const userBlock = (p: UserPart) =>
  p.kind === "text"
    ? safeMarkdown(p.text)
    : p.kind === "image"
      ? "> 🖼 image"
      : `> ${escapeText(p.text)}`;

const assistantBlock = (p: AssistantPart, cwd: string, max: number) =>
  p.kind === "text"
    ? safeMarkdown(p.text)
    : p.kind === "image"
      ? "> 🖼 image"
      : toolLine(p, cwd, max);

/**
 * A readable Markdown rendering of a chat: prompts, replies and one line per
 * tool call. Tool results, thinking and subagent lines are left out. Bounded in
 * size; never throws.
 */
export async function transcriptMarkdown(file: string, o: TranscriptOptions): Promise<string> {
  const maxTool = o.maxToolChars ?? 300;
  const maxBytes = o.maxBytes ?? 20 * MiB;
  const maxTurns = o.maxTurns ?? 5000;
  const out = [`# ${escapeText(oneLine(o.title)) || "Untitled chat"}`];
  let role: "user" | "assistant" | null = null;
  let turns = 0;
  let read = 0;
  let truncated = false;

  await streamLines(file, (raw) => {
    read += raw.length + 1;
    if (read > maxBytes) {
      truncated = true;
      return false;
    }
    // Cheap prefilter: most lines (progress, attachments, checkpoints) are neither.
    if (!raw.includes('"type":"user"') && !raw.includes('"type":"assistant"')) return;
    const l = parseJsonLine(raw);
    if (!l) return;
    const cwd = str(l.cwd) ?? "";
    const blocks =
      l.type === "user"
        ? userParts(l).map(userBlock)
        : assistantParts(l).map((p) => assistantBlock(p, cwd, maxTool));
    if (blocks.length === 0) return;
    if (l.type !== role) {
      if (turns >= maxTurns) {
        truncated = true;
        return false;
      }
      turns++;
      role = l.type === "user" ? "user" : "assistant";
      out.push(role === "user" ? "## You" : "## Claude");
      const t = timeLine(l);
      if (t) out.push(t);
    }
    out.push(...blocks);
  });
  if (truncated) out.push("*(transcript truncated)*");
  return `${out.join("\n\n")}\n`;
}
