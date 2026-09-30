import type { Dirent } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";

export const MiB = 1024 * 1024;

/** Regular files only — never follows symlinks, never reads directories. */
async function regularFile(p: string) {
  try {
    const st = await lstat(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/** Reads a small text file. `null` if missing, not a regular file, or over `maxBytes`. */
export async function readTextSafe(p: string, maxBytes = 8 * MiB): Promise<string | null> {
  const st = await regularFile(p);
  if (!st || st.size > maxBytes) return null;
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

export interface HeadTail {
  /** Complete lines from the start of the file (the whole file when `whole`). */
  head: string;
  /** Complete lines from the end of the file; empty when `whole`. */
  tail: string;
  whole: boolean;
  size: number;
  mtimeMs: number;
}

/**
 * Reads the first `headBytes` and last `tailBytes` of a file, trimmed to whole
 * lines, so a huge transcript costs a bounded amount of I/O.
 */
export async function readHeadTail(
  p: string,
  headBytes = 256 * 1024,
  tailBytes = 128 * 1024,
): Promise<HeadTail | null> {
  const st = await regularFile(p);
  if (!st) return null;
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(p, "r");
    if (st.size <= headBytes + tailBytes) {
      const buf = Buffer.alloc(st.size);
      await fh.read(buf, 0, st.size, 0);
      return {
        head: buf.toString("utf8"),
        tail: "",
        whole: true,
        size: st.size,
        mtimeMs: st.mtimeMs,
      };
    }
    const hb = Buffer.alloc(headBytes);
    await fh.read(hb, 0, headBytes, 0);
    const tb = Buffer.alloc(tailBytes);
    await fh.read(tb, 0, tailBytes, st.size - tailBytes);
    // Cut on newline bytes before decoding so no multi-byte character is split.
    const hEnd = hb.lastIndexOf(0x0a);
    const tStart = tb.indexOf(0x0a);
    return {
      head: hEnd >= 0 ? hb.subarray(0, hEnd + 1).toString("utf8") : "",
      tail: tStart >= 0 ? tb.subarray(tStart + 1).toString("utf8") : "",
      whole: false,
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

export async function listDirSafe(p: string): Promise<Dirent[]> {
  try {
    return await readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function statSafe(p: string) {
  try {
    return await lstat(p);
  } catch {
    return null;
  }
}

/** Where a path really points, links resolved. `null` if it (or its target) is missing. */
export async function realpathSafe(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}
