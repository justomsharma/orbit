import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { statSafe } from "./fsSafe";
import type { JsonObject } from "./jsonl";

/**
 * Streams a JSONL file line by line (constant memory). Corrupt lines are skipped.
 * Return `false` from `fn` to stop early. Missing files and symlinks resolve quietly.
 */
export async function streamJsonLines(p: string, fn: (o: JsonObject) => unknown): Promise<void> {
  const st = await statSafe(p);
  if (!st?.isFile()) return;
  const stream = createReadStream(p, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const raw of rl) {
      const line = raw.trim();
      if (!line.startsWith("{")) continue;
      let v: unknown;
      try {
        v = JSON.parse(line);
      } catch {
        continue;
      }
      if (v && typeof v === "object" && !Array.isArray(v) && fn(v as JsonObject) === false) break;
    }
  } catch {
    // Unreadable mid-way (e.g. file replaced): keep what we have.
  } finally {
    rl.close();
    stream.destroy();
  }
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
  fn: (line: string) => void,
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
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      let from = 0;
      for (let nl = data.indexOf(0x0a); nl !== -1; nl = data.indexOf(0x0a, from)) {
        fn(data.subarray(from, nl).toString("utf8").replace(/\r$/, ""));
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
