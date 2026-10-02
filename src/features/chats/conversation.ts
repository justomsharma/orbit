import { MiB, statSafe } from "../../core/fsSafe";
import { type JsonObject, num, obj, str } from "../../core/jsonl";
import { parseJsonLine, streamLines } from "../../core/lines";
import { redactText } from "../setup/redact";
import { assistantParts, userParts } from "./messages";

/** One turn of a chat as the detail view shows it. */
export interface Turn {
  role: "you" | "claude";
  /** Epoch ms, when known. */
  at: number | null;
  text: string;
  /** Claude's thinking, when the transcript kept it. */
  thinking: string | null;
  tools: { name: string; arg: string }[];
  /** Tokens of this reply (Claude turns). */
  usage: { input: number; output: number; cache: number } | null;
}

export interface ConversationStats {
  messages: number;
  tools: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** From the first to the last message. */
  durationMs: number;
}

export interface ConversationPage {
  total: number;
  stats: ConversationStats;
  /** Newest first for "latest", oldest first otherwise; every match when searching. */
  turns: Turn[];
  /** Turns matching the search (null when not searching). */
  matches: number | null;
}

const MAX_TEXT = 20_000;
const SHOWN_TEXT = 500;
const MAX_BYTES = 64 * MiB;
/** Tool inputs worth naming, most useful first. */
const ARG_FIELDS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "url",
  "query",
  "description",
  "prompt",
  "notebook_path",
];

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function toolArg(input: JsonObject): string {
  for (const k of ARG_FIELDS) {
    const v = str(input[k]);
    if (v) return clip(redactText(v.replace(/\s+/g, " ").trim()), 120);
  }
  const first = Object.values(input).find((v) => typeof v === "string") as string | undefined;
  return first ? clip(redactText(first.replace(/\s+/g, " ").trim()), 120) : "";
}

function thinkingOf(line: JsonObject): string {
  const content = obj(line.message)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (obj(b)?.type === "thinking" ? (str(obj(b)?.thinking) ?? "") : ""))
    .filter(Boolean)
    .join("\n\n");
}

/** Every turn of a transcript plus its totals. Claude's several lines per reply become one turn. */
export async function readTurns(
  file: string,
): Promise<{ turns: Turn[]; stats: ConversationStats }> {
  const turns: Turn[] = [];
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const counted = new Set<string>();
  let tools = 0;
  let first: number | null = null;
  let last: number | null = null;
  let current: { id: string | null; turn: Turn } | null = null;
  let read = 0;

  await streamLines(file, (raw) => {
    read += raw.length;
    if (read > MAX_BYTES) return false;
    const l = parseJsonLine(raw);
    if (!l || l.isSidechain === true) return;
    const t = Date.parse(str(l.timestamp) ?? "");
    const at = Number.isNaN(t) ? null : t;
    if (at !== null) {
      first ??= at;
      last = at;
    }
    if (l.type === "user") {
      const parts = userParts(l);
      if (!parts.length) return;
      const text = parts
        .map((p) => (p.kind === "image" ? "[image]" : p.text))
        .join("\n")
        .slice(0, MAX_TEXT);
      current = null;
      turns.push({ role: "you", at, text, thinking: null, tools: [], usage: null });
      return;
    }
    if (l.type !== "assistant") return;
    const m = obj(l.message);
    const id = str(m?.id);
    const u = obj(m?.usage);
    if (id && u && !counted.has(id)) {
      counted.add(id);
      tokens.input += num(u.input_tokens) ?? 0;
      tokens.output += num(u.output_tokens) ?? 0;
      tokens.cacheRead += num(u.cache_read_input_tokens) ?? 0;
      tokens.cacheWrite += num(u.cache_creation_input_tokens) ?? 0;
    }
    const parts = assistantParts(l);
    const thinking = thinkingOf(l);
    if (!parts.length && !thinking) return;
    if (!current || current.id !== id || !id) {
      current = {
        id,
        turn: { role: "claude", at, text: "", thinking: null, tools: [], usage: null },
      };
      turns.push(current.turn);
    }
    const turn = current.turn;
    for (const p of parts) {
      if (p.kind === "text")
        turn.text = `${turn.text ? `${turn.text}\n\n` : ""}${p.text}`.slice(0, MAX_TEXT);
      else if (p.kind === "tool") {
        tools++;
        turn.tools.push({ name: p.name, arg: toolArg(p.input) });
      }
    }
    if (thinking)
      turn.thinking = `${turn.thinking ? `${turn.thinking}\n\n` : ""}${thinking}`.slice(
        0,
        MAX_TEXT,
      );
    if (u)
      turn.usage = {
        input: num(u.input_tokens) ?? 0,
        output: num(u.output_tokens) ?? 0,
        cache: num(u.cache_read_input_tokens) ?? 0,
      };
  });
  return {
    turns,
    stats: {
      messages: turns.length,
      tools,
      tokens,
      durationMs: first !== null && last !== null ? Math.max(0, last - first) : 0,
    },
  };
}

const hit = (t: Turn, q: string) =>
  t.text.toLowerCase().includes(q) ||
  (t.thinking?.toLowerCase().includes(q) ?? false) ||
  t.tools.some((x) => x.name.toLowerCase().includes(q) || x.arg.toLowerCase().includes(q));

/** Long text cut for the list (search results keep their full text so every match shows). */
const shown = (t: Turn): Turn =>
  t.text.length > SHOWN_TEXT ? { ...t, text: `${t.text.slice(0, SHOWN_TEXT)}…` } : t;

/** A page of the conversation: the newest or oldest `limit` turns, or every turn matching `query`. */
export function pageOf(
  all: { turns: Turn[]; stats: ConversationStats },
  o: { order: "latest" | "earliest"; limit: number; query: string },
): ConversationPage {
  const q = o.query.trim().toLowerCase();
  if (q) {
    const found = all.turns.filter((t) => hit(t, q));
    return {
      total: all.turns.length,
      stats: all.stats,
      turns: found.reverse(),
      matches: found.length,
    };
  }
  const n = Math.max(1, o.limit);
  const turns = o.order === "latest" ? all.turns.slice(-n).reverse() : all.turns.slice(0, n);
  return { total: all.turns.length, stats: all.stats, turns: turns.map(shown), matches: null };
}

/** Parses each transcript once while it is unchanged (the detail view pages and searches it). */
export class ConversationCache {
  private readonly entries = new Map<
    string,
    { key: string; v: Awaited<ReturnType<typeof readTurns>> }
  >();

  async get(file: string): Promise<Awaited<ReturnType<typeof readTurns>> | null> {
    const st = await statSafe(file);
    if (!st?.isFile()) return null;
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = this.entries.get(file);
    if (hit?.key === key) return hit.v;
    const v = await readTurns(file);
    this.entries.delete(file);
    this.entries.set(file, { key, v });
    while (this.entries.size > 4) this.entries.delete(this.entries.keys().next().value!);
    return v;
  }
}
