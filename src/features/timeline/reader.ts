import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { mapLimit } from "../../core/concurrency";
import { MiB, statSafe } from "../../core/fsSafe";
import { type JsonObject, num, obj, str } from "../../core/jsonl";
import { parseJsonLine, streamLines } from "../../core/lines";
import { fileHistoryDir, normPath } from "../../core/paths";
import { isSessionId } from "../../core/uuid";
import type { ChangedFile, FileVersion } from "./types";

/** Claude's blob names. Anything else is ignored, so a line can never point outside the folder. */
const BLOB_NAME = /^[0-9a-f]{16}@v\d+$/;
const PARALLEL = 16;

interface Entry {
  path: string;
  version: number;
  at: number;
  messageId: string | null;
  /** Blob file name, or null when the file did not exist before. */
  blobName: string | null;
  fromDelta: boolean;
}

function toTime(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Where the tracked file lives. `realParentDir` is the truth; the rest are fallbacks. */
function targetPath(trackingPath: string, realParentDir: string | null, cwd: string) {
  if (realParentDir && isAbsolute(realParentDir))
    return join(realParentDir, basename(trackingPath));
  if (isAbsolute(trackingPath)) return normalize(trackingPath);
  return cwd && isAbsolute(cwd) ? resolve(cwd, trackingPath) : null;
}

/** One tracked-file backup record, or null when it is malformed or unsafe. */
function toEntry(
  trackingPath: unknown,
  backup: JsonObject | null,
  cwd: string,
  meta: { messageId: string | null; fallbackAt: number | null; fromDelta: boolean },
): Entry | null {
  const tp = str(trackingPath);
  const version = num(backup?.version);
  if (!tp || !backup || version === null || !Number.isInteger(version) || version < 1) return null;
  const name = backup.backupFileName;
  if (name !== null && (typeof name !== "string" || !BLOB_NAME.test(name))) return null;
  const path = targetPath(tp, str(backup.realParentDir), cwd);
  if (!path) return null;
  return {
    path,
    version,
    at: toTime(backup.backupTime) ?? meta.fallbackAt ?? 0,
    messageId: meta.messageId,
    blobName: name,
    fromDelta: meta.fromDelta,
  };
}

function entriesOf(l: JsonObject, cwd: string): Entry[] {
  if (l.type === "file-history-delta") {
    const e = toEntry(l.trackingPath, obj(l.backup), cwd, {
      messageId: str(l.messageId),
      fallbackAt: toTime(l.timestamp),
      fromDelta: true,
    });
    return e ? [e] : [];
  }
  if (l.type !== "file-history-snapshot") return [];
  const snap = obj(l.snapshot);
  const tracked = obj(snap?.trackedFileBackups);
  if (!tracked) return [];
  const meta = {
    messageId: str(snap?.messageId) ?? str(l.messageId),
    fallbackAt: toTime(snap?.timestamp),
    fromDelta: false,
  };
  return Object.entries(tracked).flatMap(([tp, b]) => {
    const e = toEntry(tp, obj(b), cwd, meta);
    return e ? [e] : [];
  });
}

const isRegularFile = async (p: string) => (await statSafe(p))?.isFile() === true;

/**
 * Files Claude changed in one chat, from the checkpoints it records in the
 * transcript, most recently changed first. Read-only; never throws.
 */
export async function readTimeline(opts: {
  home: string;
  sessionId: string;
  transcript: string;
  cwd: string;
}): Promise<ChangedFile[]> {
  if (!isSessionId(opts.sessionId)) return [];
  const blobDir = join(fileHistoryDir(opts.home), opts.sessionId);
  // (file, version) → entry. A delta describes one edit exactly, so it beats a snapshot.
  const byVersion = new Map<string, Entry>();
  try {
    await streamLines(opts.transcript, (raw) => {
      if (!raw.includes("file-history")) return;
      const l = parseJsonLine(raw);
      if (!l) return;
      for (const e of entriesOf(l, opts.cwd)) {
        const key = `${normPath(e.path)}\n${e.version}`;
        const had = byVersion.get(key);
        if (!had || (e.fromDelta && !had.fromDelta)) byVersion.set(key, e);
      }
    });
    const byFile = new Map<string, Entry[]>();
    for (const e of byVersion.values()) {
      const k = normPath(e.path);
      const list = byFile.get(k);
      if (list) list.push(e);
      else byFile.set(k, [e]);
    }
    const files = await mapLimit([...byFile.values()], PARALLEL, async (entries) => {
      entries.sort((a, b) => a.version - b.version);
      const versions = await Promise.all(
        entries.map(async (e): Promise<FileVersion> => {
          const blob = e.blobName === null ? null : join(blobDir, e.blobName);
          return {
            version: e.version,
            at: e.at,
            messageId: e.messageId,
            blob,
            available: blob === null || (await isRegularFile(blob)),
          };
        }),
      );
      const path = entries[0]!.path;
      return {
        path,
        name: basename(path),
        versions,
        createdByClaude: versions[0]!.blob === null,
        exists: (await statSafe(path)) !== null,
      } satisfies ChangedFile;
    });
    const latest = (f: ChangedFile) => Math.max(...f.versions.map((v) => v.at));
    return files.sort((a, b) => latest(b) - latest(a));
  } catch {
    return [];
  }
}

/** Only `…/file-history/<sessionId>/<hex>@vN` is ever read, whatever the caller passes. */
function isBlobPath(p: string): boolean {
  const dir = dirname(p);
  return (
    isAbsolute(p) &&
    BLOB_NAME.test(basename(p)) &&
    isSessionId(basename(dir)) &&
    basename(dirname(dir)) === "file-history"
  );
}

/**
 * The content a file had before the edit that made version `v`. `{ binary: true }`
 * when the bytes are not UTF-8 text (restore is not offered for those); null when
 * there is no blob (Claude created the file), it is missing, a symlink, or over `maxBytes`.
 */
export async function readVersion(
  v: FileVersion,
  maxBytes = 5 * MiB,
): Promise<{ text: string } | { binary: true } | null> {
  const p = v.blob;
  if (!p || !isBlobPath(p)) return null;
  // The session folder must be a real folder, not a link to somewhere else.
  const dir = await statSafe(dirname(p));
  if (!dir?.isDirectory()) return null;
  const st = await statSafe(p);
  if (!st?.isFile() || st.size > maxBytes) return null;
  let buf: Buffer;
  try {
    buf = await readFile(p);
  } catch {
    return null;
  }
  if (buf.length > maxBytes) return null;
  const text = buf.toString("utf8");
  // Invalid UTF-8 does not survive a round trip; NUL bytes mean binary too.
  if (buf.includes(0) || !Buffer.from(text, "utf8").equals(buf)) return { binary: true };
  return { text };
}
