import { parseJsonLine, streamLines } from "../../core/lines";
import { assistantParts, userParts } from "./messages";

export interface MessageHit {
  sessionId: string;
  /** About 140 characters around the first match, with "…" where text was cut. */
  snippet: string;
  /** Matches across the whole chat. */
  count: number;
}

export interface SearchOptions {
  signal?: AbortSignal;
  /** Stop after this many chats matched (default 200). */
  maxHits?: number;
  onProgress?: (done: number, total: number) => void;
}

const SNIPPET = 140;
const CHECK_EVERY = 2000;

/** The words people read in a line: prompt text and reply text, never tool data. */
function readableTexts(raw: string): string[] {
  const l = parseJsonLine(raw);
  if (!l) return [];
  if (l.type === "user") return userParts(l).flatMap((p) => (p.kind === "text" ? [p.text] : []));
  return assistantParts(l).flatMap((p) => (p.kind === "text" ? [p.text] : []));
}

function snippetAt(text: string, at: number, len: number): string {
  const side = Math.max(20, Math.floor((SNIPPET - len) / 2));
  const start = Math.max(0, at - side);
  const end = Math.min(text.length, at + len + side);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Case-insensitive full-text search over what people read in their chats
 * (prompts and replies; not tool calls, tool results or JSON keys). Results
 * follow the order of `files`. Read-only; never throws.
 */
export async function searchMessages(
  files: { id: string; file: string }[],
  query: string,
  opts: SearchOptions = {},
): Promise<MessageHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const maxHits = opts.maxHits ?? 200;
  // Raw-line prefilter: the query as it appears inside a JSON string.
  const inJson = new RegExp(escapeRe(JSON.stringify(q).slice(1, -1)), "i");
  const inText = new RegExp(escapeRe(q), "gi");
  const hits: MessageHit[] = [];
  const aborted = () => opts.signal?.aborted === true;

  for (let i = 0; i < files.length && hits.length < maxHits && !aborted(); i++) {
    const { id, file } = files[i]!;
    let count = 0;
    let snippet: string | null = null;
    let n = 0;
    try {
      await streamLines(file, (raw) => {
        if (++n % CHECK_EVERY === 0 && aborted()) return false;
        if (!raw.includes('"type":"user"') && !raw.includes('"type":"assistant"')) return;
        // Tool output is never searched; skip parsing what would be thrown away.
        if (raw.includes('"type":"tool_result"')) return;
        if (!inJson.test(raw)) return;
        for (const text of readableTexts(raw)) {
          const found = [...text.matchAll(inText)];
          if (found.length === 0) continue;
          count += found.length;
          snippet ??= snippetAt(text, found[0]!.index, found[0]![0].length);
        }
      });
    } catch {
      // Unreadable file: no hit.
    }
    if (aborted()) break;
    if (snippet !== null) hits.push({ sessionId: id, snippet, count });
    opts.onProgress?.(i + 1, files.length);
  }
  return hits;
}
