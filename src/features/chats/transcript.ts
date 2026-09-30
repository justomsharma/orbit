import { relative } from "node:path";
import { MiB } from "../../core/fsSafe";
import { type JsonObject, str } from "../../core/jsonl";
import { parseJsonLine, streamLines } from "../../core/lines";
import { isInside } from "../../core/paths";
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

function toolLine(p: { name: string; input: JsonObject }, cwd: string, max: number): string {
  for (const f of TOOL_FIELDS) {
    let v = str(p.input[f]);
    if (!v?.trim()) continue;
    if (PATH_FIELDS.has(f) && cwd && isInside(cwd, v)) v = relative(cwd, v) || ".";
    return `> 🔧 ${p.name} · ${clip(oneLine(v), max)}`;
  }
  return `> 🔧 ${p.name}`;
}

const userBlock = (p: UserPart) =>
  p.kind === "text" ? p.text : p.kind === "image" ? "> 🖼 image" : `> ${p.text}`;

const assistantBlock = (p: AssistantPart, cwd: string, max: number) =>
  p.kind === "text" ? p.text : p.kind === "image" ? "> 🖼 image" : toolLine(p, cwd, max);

/**
 * A readable Markdown rendering of a chat: prompts, replies and one line per
 * tool call. Tool results, thinking and subagent lines are left out. Bounded in
 * size; never throws.
 */
export async function transcriptMarkdown(file: string, o: TranscriptOptions): Promise<string> {
  const maxTool = o.maxToolChars ?? 300;
  const maxBytes = o.maxBytes ?? 20 * MiB;
  const maxTurns = o.maxTurns ?? 5000;
  const out = [`# ${oneLine(o.title) || "Untitled chat"}`];
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
