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
 * Outside code: `<` can't start HTML, `![` can't load an image, and `](` can't
 * make a link (a chat's link could otherwise run a VS Code command when clicked).
 */
const escapeText = (s: string) =>
  s.replace(/</g, "\\<").replace(/!\[/g, "!\\[").replace(/\]\(/g, "]\\(");

function escapeLine(line: string): string {
  // A person's "# …" line must not look like one of the transcript's own headings.
  const l = line.replace(/^(\s{0,3})(#{1,6})(?=\s|$)/, "$1\\$2");
  let out = "";
  let at = 0;
  for (const m of l.matchAll(/(`+)[\s\S]*?\1/g)) {
    out += escapeText(l.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + escapeText(l.slice(at));
}

/**
 * Chat text as Markdown that shows exactly what was written: no raw HTML, no
 * images (which the preview would fetch from the web), no stray headings.
 * Code blocks and inline code are left as they are.
 */
export function safeMarkdown(text: string): string {
  let fence: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return line;
      }
      return fence ? line : escapeLine(line);
    })
    .join("\n");
}

function toolLine(p: { name: string; input: JsonObject }, cwd: string, max: number): string {
  for (const f of TOOL_FIELDS) {
    let v = str(p.input[f]);
    if (!v?.trim()) continue;
    if (PATH_FIELDS.has(f) && cwd && isInside(cwd, v)) v = relative(cwd, v) || ".";
    // Commands often carry tokens; the transcript may be exported and shared.
    return `> 🔧 ${p.name} · ${codeSpan(clip(oneLine(redactText(v)), max))}`;
  }
  return `> 🔧 ${p.name}`;
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
