import { createReadStream } from "node:fs";
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
