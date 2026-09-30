import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { statSafe } from "./fsSafe";
import type { JsonObject } from "./jsonl";

/**
 * Streams a text file line by line (constant memory), unparsed, so callers can
 * cheaply skip lines before paying for JSON.parse. Return `false` from `fn` to
 * stop early. Missing files and symlinks resolve quietly.
 */
export async function streamLines(p: string, fn: (line: string) => unknown): Promise<void> {
  const st = await statSafe(p);
  if (!st?.isFile()) return;
  const stream = createReadStream(p, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const raw of rl) if (fn(raw) === false) break;
  } catch {
    // Unreadable mid-way (e.g. file replaced): keep what we have.
  } finally {
    rl.close();
    stream.destroy();
  }
}

/** Parses one JSONL line; null for blank, corrupt and non-object lines. */
export function parseJsonLine(raw: string): JsonObject | null {
  const line = raw.trim();
  if (!line.startsWith("{")) return null;
  try {
    const v: unknown = JSON.parse(line);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : null;
  } catch {
    return null;
  }
}

/**
 * Streams a JSONL file line by line (constant memory). Corrupt lines are skipped.
 * Return `false` from `fn` to stop early. Missing files and symlinks resolve quietly.
 */
export async function streamJsonLines(p: string, fn: (o: JsonObject) => unknown): Promise<void> {
  await streamLines(p, (raw) => {
    const o = parseJsonLine(raw);
    return o === null || fn(o) !== false;
  });
}

const CHUNK = 4 * 1024 * 1024;

/**
 * Calls `fn` for every complete line written after byte `start`, reading in
 * bounded chunks. Returns the byte offset to resume from next time (just after
 * the last newline), or null when the file is missing or now shorter than
 * `start` (it was rewritten — the caller should start over).
 */
export async function forEachAppendedLine(
  p: string,
  start: number,
  /** `at` is the byte offset where the line starts, for readLineAt later. */
  fn: (line: string, at: number) => void,
): Promise<number | null> {
  const st = await statSafe(p);
  if (!st?.isFile() || st.size < start) return null;
  if (st.size === start) return start;
  const fh = await open(p, "r");
  try {
    let pos = start;
    let next = start;
    let carry: Buffer = Buffer.alloc(0);
    while (pos < st.size) {
      const buf = Buffer.alloc(Math.min(CHUNK, st.size - pos));
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      pos += bytesRead;
      const data = carry.length
        ? Buffer.concat([carry, buf.subarray(0, bytesRead)])
        : buf.subarray(0, bytesRead);
      let from = 0;
      for (let nl = data.indexOf(0x0a); nl !== -1; nl = data.indexOf(0x0a, from)) {
        fn(data.subarray(from, nl).toString("utf8").replace(/\r$/, ""), pos - data.length + from);
        from = nl + 1;
      }
      next = pos - (data.length - from);
      carry = Buffer.from(data.subarray(from));
    }
    return next;
  } finally {
    await fh.close();
  }
}

export async function readAppendedLines(
  p: string,
  start: number,
): Promise<{ lines: string[]; next: number } | null> {
  const lines: string[] = [];
  const next = await forEachAppendedLine(p, start, (l) => lines.push(l));
  return next === null ? null : { lines, next };
}

/**
 * The one line starting at byte `at` (as forEachAppendedLine reported it), or
 * null when the file is missing, `at` is past its end, or the line is longer
 * than `maxBytes`.
 */
export async function readLineAt(
  p: string,
  at: number,
  maxBytes = 32 * 1024 * 1024,
): Promise<string | null> {
  const st = await statSafe(p);
  if (!st?.isFile() || at < 0 || at >= st.size) return null;
  const fh = await open(p, "r");
  try {
    const parts: Buffer[] = [];
    let pos = at;
    while (pos < st.size && pos - at <= maxBytes) {
      const buf = Buffer.alloc(Math.min(1024 * 1024, st.size - pos));
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      const chunk = buf.subarray(0, bytesRead);
      const nl = chunk.indexOf(0x0a);
      if (nl !== -1) {
        parts.push(chunk.subarray(0, nl));
        return Buffer.concat(parts).toString("utf8").replace(/\r$/, "");
      }
      parts.push(chunk);
      pos += bytesRead;
    }
    return pos - at > maxBytes ? null : Buffer.concat(parts).toString("utf8");
  } finally {
    await fh.close();
  }
}
