import { createReadStream } from "node:fs";

export interface AppendedRead {
  /** Bytes consumed, up to and including the last newline read. */
  bytes: number;
  /** False when the read stopped on an error; what was consumed is still valid. */
  ok: boolean;
}

/**
 * Streams bytes `[start, end)` of a file and hands `onText` every run of complete lines.
 * Text after the last newline (a line Claude is still writing) is left for next time.
 * Lines are cut on newline bytes before decoding, so multi-byte characters stay whole.
 */
export async function readAppended(
  file: string,
  start: number,
  end: number,
  onText: (text: string) => void,
): Promise<AppendedRead> {
  if (end <= start) return { bytes: 0, ok: true };
  let bytes = 0;
  let pending: Buffer[] = [];
  const stream = createReadStream(file, { start, end: end - 1, highWaterMark: 256 * 1024 });
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const nl = chunk.lastIndexOf(0x0a);
      if (nl === -1) {
        pending.push(chunk);
        continue;
      }
      const head = chunk.subarray(0, nl + 1);
      const block = pending.length ? Buffer.concat([...pending, head]) : head;
      pending = nl + 1 < chunk.length ? [chunk.subarray(nl + 1)] : [];
      onText(block.toString("utf8"));
      bytes += block.length;
    }
    return { bytes, ok: true };
  } catch {
    return { bytes, ok: false };
  } finally {
    stream.destroy();
  }
}
