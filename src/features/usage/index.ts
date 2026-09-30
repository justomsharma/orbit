import { mapLimit } from "../../core/concurrency";
import { statSafe } from "../../core/fsSafe";
import { obj } from "../../core/jsonl";
import { type UsageFile, usageFiles } from "./files";
import { forEachUsage } from "./parse";
import { readAppended } from "./readAppended";
import type { UsageRecord } from "./types";

const PARALLEL = 16;

interface FileEntry {
  size: number;
  mtimeMs: number;
  /** File identity; a different one means the transcript was replaced, not appended to. */
  ino?: number;
  /** Byte just after the last complete line read. */
  offset: number;
  records: UsageRecord[];
}

/** What the caller persists between runs so only new bytes are read next time. */
export interface IndexState {
  v: 1;
  files: Record<string, FileEntry>;
}

function validEntry(v: unknown): FileEntry | null {
  const e = obj(v);
  if (!e || !Array.isArray(e.records)) return null;
  const { size, mtimeMs, offset } = e;
  if (typeof size !== "number" || typeof mtimeMs !== "number" || typeof offset !== "number") {
    return null;
  }
  const records = (e.records as unknown[]).filter(
    (r): r is UsageRecord => typeof obj(r)?.id === "string" && typeof obj(r)?.t === "number",
  );
  const ino = typeof e.ino === "number" ? e.ino : undefined;
  return { size, mtimeMs, offset, records, ...(ino === undefined ? {} : { ino }) };
}

/**
 * Usage of every transcript, kept up to date by reading only the bytes appended since
 * the last `update()`. A file that shrank is read again from the start; a file that
 * disappeared is dropped. The same message id is counted once across all files.
 */
export class UsageIndex {
  private files: Record<string, FileEntry> = {};
  /** Per file: message id → its record, so a later line of the same message can update it. */
  private readonly ids = new Map<string, Map<string, UsageRecord>>();
  private memo: UsageRecord[] | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly home: string,
    state?: IndexState,
  ) {
    if (state?.v !== 1) return;
    for (const [file, v] of Object.entries(obj(state.files) ?? {})) {
      const e = validEntry(v);
      if (e) this.files[file] = e;
    }
  }

  /** Runs one pass at a time, so overlapping calls never read the same bytes twice. */
  update(): Promise<{ changed: boolean }> {
    const run = this.queue.then(() => this.pass());
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Deduped by message id, oldest first. A message copied into several chats
   * (resume/fork) is counted once: the earliest copy's time and chat, with the
   * fullest output count seen. Same array until something changes.
   */
  records(): UsageRecord[] {
    if (this.memo) return this.memo;
    const all = Object.keys(this.files)
      .sort()
      .flatMap((k) => this.files[k]!.records);
    all.sort((a, b) => a.t - b.t);
    const best = new Map<string, UsageRecord>();
    for (const r of all) {
      const first = best.get(r.id);
      if (!first) best.set(r.id, r);
      else if (r.output > first.output) {
        best.set(r.id, { ...r, t: first.t, session: first.session, cwd: first.cwd });
      }
    }
    this.memo = [...best.values()];
    return this.memo;
  }

  state(): IndexState {
    const files: Record<string, FileEntry> = {};
    for (const [k, e] of Object.entries(this.files)) files[k] = { ...e, records: [...e.records] };
    return { v: 1, files };
  }

  private async pass(): Promise<{ changed: boolean }> {
    const list = await usageFiles(this.home);
    const listed = new Set(list.map((f) => f.file));
    let changed = false;
    for (const file of Object.keys(this.files)) {
      if (!listed.has(file)) changed = this.drop(file) || changed;
    }
    const results = await mapLimit(list, PARALLEL, (f) => this.refresh(f));
    changed = results.includes(true) || changed;
    if (changed) this.memo = null;
    return { changed };
  }

  private drop(file: string): boolean {
    const had = (this.files[file]?.records.length ?? 0) > 0;
    delete this.files[file];
    this.ids.delete(file);
    return had;
  }

  /** Brings one file up to date. True when its records changed. */
  private async refresh({ file, session }: UsageFile): Promise<boolean> {
    const st = await statSafe(file);
    if (!st?.isFile()) return this.drop(file);
    let e = this.files[file];
    if (e && e.size === st.size && e.mtimeMs === st.mtimeMs) return false;

    let removed = false;
    const replaced = e?.ino !== undefined && st.ino !== 0 && e.ino !== st.ino;
    if (!e || st.size < e.offset || replaced) {
      removed = e ? this.drop(file) : false;
      e = { size: -1, mtimeMs: -1, offset: 0, records: [] };
      this.files[file] = e;
    }
    const entry = e;
    const ids = this.idsOf(file, entry);
    let added = false;
    const read = await readAppended(file, entry.offset, st.size, (text) =>
      forEachUsage(text, session, (r) => {
        const seen = ids.get(r.id);
        if (!seen) {
          ids.set(r.id, r);
          entry.records.push(r);
          added = true;
        } else if (r.output > seen.output) {
          // A message is written as several lines; the last carries the final counts.
          // Keep the first line's time, take the fuller usage.
          Object.assign(seen, { ...r, t: seen.t });
          added = true;
        }
      }),
    );
    entry.offset += read.bytes;
    // After a failed read keep the old size so the next pass tries again.
    if (read.ok) {
      entry.size = st.size;
      entry.mtimeMs = st.mtimeMs;
      entry.ino = st.ino;
    }
    return removed || added;
  }

  private idsOf(file: string, e: FileEntry): Map<string, UsageRecord> {
    let s = this.ids.get(file);
    if (!s) {
      s = new Map(e.records.map((r) => [r.id, r]));
      this.ids.set(file, s);
    }
    return s;
  }
}
