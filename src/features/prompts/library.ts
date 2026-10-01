import { createHash } from "node:crypto";
import { join } from "node:path";
import { readTextSafe } from "../../core/fsSafe";
import { num, obj, str } from "../../core/jsonl";
import { forEachAppendedLine, readLineAt } from "../../core/lines";
import { historyFile } from "../../core/paths";
import { isSessionId } from "../../core/uuid";

/** A pasted block as history records it: inline text, or a hash into `paste-cache/`. */
export interface PastedRef {
  type: string;
  content?: string;
  contentHash?: string;
}

/** One prompt someone typed, with its repeats collapsed. */
export interface PromptEntry {
  id: string;
  text: string;
  count: number;
  first: number;
  last: number;
  project: string | null;
  /** The chat it was most recently typed in. */
  sessionId: string | null;
  /** Pasted blocks in the latest copy. */
  pastes: number;
}

interface Stored extends PromptEntry {
  /** Where the latest copy's line starts in history.jsonl; its pastes are read from there when needed. */
  at: number;
  /** The dedupe key, to check that line is still the same prompt. */
  key: string;
}

/** Bare commands like "/model" or "/compact" aren't worth keeping as prompts. */
const BARE_COMMAND = /^\/[\w:.-]+$/;
const PASTE = /\[Pasted text #(\d+)(?: \+\d+ lines?)?\]/g;
const HASH = /^[0-9a-f]{16}$/;

const normalize = (s: string) => s.trim().replace(/\s+/g, " ");
const idFor = (key: string) => createHash("sha1").update(key).digest("hex").slice(0, 12);

function pastedRefs(v: unknown): Record<string, PastedRef> {
  const out: Record<string, PastedRef> = {};
  for (const [k, raw] of Object.entries(obj(v) ?? {})) {
    const p = obj(raw);
    const type = str(p?.type);
    if (!p || !type) continue;
    const content = str(p.content);
    const contentHash = str(p.contentHash);
    out[k] = {
      type,
      ...(content !== null ? { content } : {}),
      ...(contentHash !== null ? { contentHash } : {}),
    };
  }
  return out;
}

/** Pasted blocks Orbit can read (the same ones it restores). */
const pasteCount = (v: unknown) => Object.keys(pastedRefs(v)).length;

/** The text plus what was pasted, so prompts that look alike but pasted different text stay apart. */
const keyOf = (text: string, pasted: Record<string, PastedRef>) =>
  `${text}\u0000${pasteSignature(pasted)}`;

/** What was pasted, so two prompts that look alike but pasted different text stay apart. */
function pasteSignature(pasted: Record<string, PastedRef>): string {
  return Object.keys(pasted)
    .sort()
    .map((k) => {
      const p = pasted[k]!;
      return `${k}:${p.contentHash ?? (p.content !== undefined ? idFor(p.content) : "")}`;
    })
    .join(",");
}

/**
 * Every prompt from `history.jsonl`, repeats collapsed into one entry with a
 * count. Reads only what Claude appended since the last update. Read-only.
 */
export class PromptLibrary {
  private offset = 0;
  private byKey = new Map<string, Stored>();
  private byId = new Map<string, Stored>();

  constructor(private readonly home: string) {}

  private pending: Promise<PromptEntry[]> | null = null;

  private add(line: string, at: number): void {
    if (!line.startsWith("{")) return;
    let o: Record<string, unknown> | null;
    try {
      o = obj(JSON.parse(line));
    } catch {
      return;
    }
    const display = str(o?.display);
    if (!o || display === null) return;
    const text = normalize(display);
    if (!text || BARE_COMMAND.test(text)) return;
    const t = num(o.timestamp) ?? 0;
    const sid = str(o.sessionId);
    const sessionId = isSessionId(sid) ? sid : null;
    const project = str(o.project);
    const key = keyOf(text, pastedRefs(o.pastedContents));
    const e = this.byKey.get(key);
    if (!e) {
      const s: Stored = {
        id: idFor(key),
        text: display.trim(),
        count: 1,
        first: t,
        last: t,
        project,
        sessionId,
        pastes: pasteCount(o.pastedContents),
        at,
        key,
      };
      this.byKey.set(key, s);
      this.byId.set(s.id, s);
      return;
    }
    e.count++;
    e.first = Math.min(e.first, t);
    if (t >= e.last) {
      e.last = t;
      e.text = display.trim();
      e.project = project ?? e.project;
      e.sessionId = sessionId ?? e.sessionId;
      e.at = at;
      e.pastes = pasteCount(o.pastedContents);
    }
  }

  /** Reads what Claude appended since last time. Overlapping calls share one read. */
  update(): Promise<PromptEntry[]> {
    if (this.pending) return this.pending;
    this.pending = this.read().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async read(): Promise<PromptEntry[]> {
    const file = historyFile(this.home);
    const add = (l: string, at: number) => this.add(l, at);
    let next = await forEachAppendedLine(file, this.offset, add);
    if (next === null) {
      // Missing or rewritten: start over.
      this.byKey = new Map();
      this.byId = new Map();
      next = (await forEachAppendedLine(file, 0, add)) ?? 0;
    }
    this.offset = next;
    return [...this.byKey.values()]
      .sort((a, b) => b.last - a.last)
      .map(({ at: _at, key: _key, ...entry }) => entry);
  }

  /**
   * An entry with its latest pasted blocks, for copying or reusing it. Pastes are
   * read from history now rather than kept in memory; if the file was rewritten
   * since, the prompt comes back without them (placeholders stay).
   */
  async get(id: string): Promise<(PromptEntry & { pasted: Record<string, PastedRef> }) | null> {
    const e = this.byId.get(id);
    if (!e) return null;
    const { at, key, ...entry } = e;
    const line = await readLineAt(historyFile(this.home), at);
    let pasted: Record<string, PastedRef> = {};
    try {
      const o = line ? obj(JSON.parse(line)) : null;
      const display = str(o?.display);
      const refs = pastedRefs(o?.pastedContents);
      if (display !== null && keyOf(normalize(display), refs) === key) pasted = refs;
    } catch {
      // Not the same line any more.
    }
    return { ...entry, pasted };
  }
}

/**
 * Puts pasted text back where history shows "[Pasted text #1 +20 lines]".
 * Reads only `paste-cache/<16 hex>.txt` (no symlinks). A paste Claude no longer
 * has keeps its placeholder and is counted in `missing`.
 */
export async function expandPrompt(
  home: string,
  text: string,
  pasted: Record<string, PastedRef>,
): Promise<{ text: string; missing: number }> {
  const found = new Map<string, string>();
  const seen = new Set<string>();
  let missing = 0;
  for (const m of text.matchAll(PASTE)) {
    const n = m[1]!;
    if (seen.has(n)) continue;
    seen.add(n);
    const p = pasted[n];
    let body: string | null = null;
    if (p?.type === "text") {
      if (p.content !== undefined) body = p.content;
      else if (p.contentHash && HASH.test(p.contentHash))
        body = await readTextSafe(join(home, "paste-cache", `${p.contentHash}.txt`));
    }
    if (body === null) missing++;
    else found.set(n, body);
  }
  return {
    text: text.replace(PASTE, (whole, n: string) => found.get(n) ?? whole),
    missing,
  };
}
