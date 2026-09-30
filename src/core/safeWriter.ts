import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseJsonObject, stringifyLike } from "./json";

/** The file changed between preview and write (or after Orbit's edit, for undo). */
/** Backups can contain secrets (settings `env`): only the person may read them. */
const PRIVATE_FILE = 0o600;
const PRIVATE_DIR = 0o700;

export class ConflictError extends Error {
  override name = "ConflictError";
}

/** The file's current text can't be understood, so Orbit won't touch it. */
export class UnparseableError extends Error {
  override name = "UnparseableError";
}

export interface EditPlan {
  file: string;
  /** Current text, `null` if the file does not exist. */
  before: string | null;
  after: string;
  /** sha256 of the file's bytes when planned, `null` if it did not exist. */
  beforeHash: string | null;
}

export interface UndoEntry {
  id: string;
  file: string;
  /** Copy of the original bytes, `null` if the file did not exist before. */
  backup: string | null;
  afterHash: string;
  at: number;
  label: string;
}

interface Current {
  bytes: Buffer;
  mode: number;
}

const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const LOG_KEY = "\0undo-log";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
}

/** Reads the target without following symlinks. `null` if it does not exist. */
async function readTarget(file: string): Promise<Current | null> {
  let st: Awaited<ReturnType<typeof lstat>>;
  try {
    st = await lstat(file);
  } catch (e) {
    if (errCode(e) === "ENOENT") return null;
    throw e;
  }
  if (st.isSymbolicLink())
    throw new Error(
      `Orbit doesn't edit linked files: ${file} is a link. Edit the file it points to instead.`,
    );
  if (!st.isFile()) throw new Error(`${file} is not a regular file`);
  return { bytes: await readFile(file), mode: st.mode & 0o7777 };
}

function hashOf(cur: Current | null): string | null {
  return cur ? sha256(cur.bytes) : null;
}

/**
 * rename(), retried with growing backoff (50ms, 100ms, …, 5 retries) while Windows
 * reports the target as busy because another process has it open.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  doRename: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await doRename(from, to);
    } catch (e) {
      if (attempt >= 5 || !RETRY_CODES.has(errCode(e) ?? "")) throw e;
      await delay(50 * (attempt + 1));
    }
  }
}

/**
 * Writes `data` to a unique temp file next to `target`, then renames it over the
 * target, so readers see either the old or the new file, never half of one.
 * `guard` runs just before the rename and may throw to abort; the temp file is
 * always cleaned up on failure.
 */
export async function writeFileAtomic(
  target: string,
  data: Buffer | string,
  opts: { mode?: number; guard?: () => Promise<void> } = {},
): Promise<void> {
  const tmp = join(
    dirname(target),
    `.${basename(target)}.orbit-${randomBytes(6).toString("hex")}.tmp`,
  );
  const fh = await open(tmp, "wx");
  try {
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (opts.mode !== undefined) await chmod(tmp, opts.mode);
    await opts.guard?.();
    await renameWithRetry(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/**
 * The only way Orbit edits someone's files: preview (plan) → backup → atomic
 * write (apply) → undo. Refuses to write when the file changed since the
 * preview, and refuses to undo when it changed after Orbit's edit.
 * Operations on the same file are serialized within one instance.
 */
export class SafeWriter {
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly logPath: string;
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly backupDir: string,
    opts: { now?: () => number; maxEntries?: number } = {},
  ) {
    this.backupDir = resolve(backupDir);
    this.now = opts.now ?? Date.now;
    this.maxEntries = Math.max(1, opts.maxEntries ?? 100);
    this.logPath = join(this.backupDir, "undo.json");
  }

  /** Reads the file and computes the new text. Refuses symlinks and non-UTF-8 files. */
  async plan(file: string, transform: (before: string | null) => string): Promise<EditPlan> {
    const abs = resolve(file);
    const cur = await readTarget(abs);
    let before: string | null = null;
    if (cur) {
      before = cur.bytes.toString("utf8");
      if (!Buffer.from(before, "utf8").equals(cur.bytes)) {
        throw new UnparseableError(`${abs} is not valid UTF-8 text. Orbit won't edit it.`);
      }
    }
    return { file: abs, before, after: transform(before), beforeHash: hashOf(cur) };
  }

  /**
   * Plans an edit of a JSON object file, keeping its indentation, line endings and
   * trailing newline. A missing, empty or blank file counts as `{}`.
   */
  planJson(file: string, mutate: (obj: Record<string, unknown>) => void): Promise<EditPlan> {
    return this.plan(file, (before) => {
      const obj = before === null || before.trim() === "" ? {} : parseJsonObject(before);
      if (!obj) {
        throw new UnparseableError(
          `${resolve(file)} is not a plain JSON object (comments, trailing commas or a typo?). Orbit won't edit it.`,
        );
      }
      mutate(obj);
      return stringifyLike(obj, before);
    });
  }

  /**
   * Writes the plan if the file is still exactly as previewed. When `after`
   * equals the current content nothing is written, no backup is made and the
   * returned entry is not added to history.
   */
  apply(plan: EditPlan, label: string): Promise<UndoEntry> {
    const file = resolve(plan.file);
    return this.locked(file, async () => {
      const conflict = () =>
        new ConflictError(`${file} changed since the preview. Nothing was written.`);
      // Checked now, and again right before the rename to shrink the race window.
      const check = async () => {
        if (hashOf(await readTarget(file)) !== plan.beforeHash) throw conflict();
      };
      const cur = await readTarget(file);
      if (hashOf(cur) !== plan.beforeHash) throw conflict();
      const after = Buffer.from(plan.after, "utf8");
      const at = this.now();
      const entry: UndoEntry = {
        id: randomUUID(),
        file,
        backup: null,
        afterHash: sha256(after),
        at,
        label,
      };
      if (cur?.bytes.equals(after)) return entry;

      if (cur) entry.backup = await this.saveBackup(file, cur.bytes, at);
      else await mkdir(dirname(file), { recursive: true });
      try {
        await writeFileAtomic(file, after, { mode: cur?.mode, guard: check });
      } catch (e) {
        if (entry.backup) await unlink(entry.backup).catch(() => {});
        throw e;
      }
      await this.mutateLog((all) => {
        all.push(entry);
        return all.splice(0, Math.max(0, all.length - this.maxEntries));
      });
      return entry;
    });
  }

  /** Puts the original bytes back (or deletes a file Orbit created), if nobody edited it since. */
  async undo(id: string): Promise<void> {
    const found = (await this.history()).find((e) => e.id === id);
    if (!found) throw new Error(`No undo entry with id ${id}`);
    await this.locked(found.file, async () => {
      const entry = (await this.history()).find((e) => e.id === id);
      if (!entry) throw new Error(`No undo entry with id ${id}`);
      const conflict = () =>
        new ConflictError(
          entry.backup
            ? `${entry.file} changed after Orbit's edit; restore the backup manually: ${entry.backup}`
            : `${entry.file} changed after Orbit's edit; Orbit created it, so delete it manually if you no longer want it.`,
        );
      const cur = await readTarget(entry.file);
      if (!cur || hashOf(cur) !== entry.afterHash) throw conflict();
      if (entry.backup) {
        const original = await readFile(entry.backup);
        await writeFileAtomic(entry.file, original, {
          mode: cur.mode,
          guard: async () => {
            if (hashOf(await readTarget(entry.file)) !== entry.afterHash) throw conflict();
          },
        });
      } else {
        // Check again right before deleting, so a write in between is never lost.
        if (hashOf(await readTarget(entry.file)) !== entry.afterHash) throw conflict();
        await unlink(entry.file);
      }
      await this.mutateLog((all) => {
        const i = all.findIndex((e) => e.id === id);
        return i >= 0 ? all.splice(i, 1) : [];
      });
    });
  }

  /** Recorded edits, newest first. */
  history(): Promise<UndoEntry[]> {
    return this.locked(LOG_KEY, async () => (await this.readLog()).reverse());
  }

  /** Runs `fn` after every earlier operation on the same key has settled. */
  private locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const k = key === LOG_KEY ? key : resolve(key).toLowerCase();
    const run = (this.chains.get(k) ?? Promise.resolve()).then(fn);
    const tail = run.then(
      () => {},
      () => {},
    );
    this.chains.set(k, tail);
    void tail.then(() => {
      if (this.chains.get(k) === tail) this.chains.delete(k);
    });
    return run;
  }

  private async saveBackup(file: string, bytes: Buffer, at: number): Promise<string> {
    await mkdir(this.backupDir, { recursive: true, mode: PRIVATE_DIR });
    const stem = `${at}-${basename(file)}-${sha256(bytes).slice(0, 8)}`;
    for (let n = 0; ; n++) {
      const p = join(this.backupDir, n === 0 ? `${stem}.bak` : `${stem}-${n}.bak`);
      try {
        await writeFile(p, bytes, { flag: "wx", mode: PRIVATE_FILE });
        return p;
      } catch (e) {
        if (errCode(e) !== "EEXIST") throw e;
      }
    }
  }

  /** Entries oldest first. Missing or corrupt log = empty; other read errors throw. */
  private async readLog(): Promise<UndoEntry[]> {
    let text: string;
    try {
      text = await readFile(this.logPath, "utf8");
    } catch (e) {
      if (errCode(e) === "ENOENT") return [];
      throw e;
    }
    try {
      const v = JSON.parse(text) as { entries?: unknown };
      return Array.isArray(v.entries) ? v.entries.filter((e) => this.isEntry(e)) : [];
    } catch {
      return [];
    }
  }

  /** Edits the log; `fn` returns the entries it removed, whose backups are then deleted. */
  private mutateLog(fn: (all: UndoEntry[]) => UndoEntry[]): Promise<void> {
    return this.locked(LOG_KEY, async () => {
      const all = await this.readLog();
      const removed = fn(all);
      await mkdir(this.backupDir, { recursive: true, mode: PRIVATE_DIR });
      await writeFileAtomic(this.logPath, `${JSON.stringify({ v: 1, entries: all }, null, 2)}\n`, {
        mode: PRIVATE_FILE,
      });
      for (const e of removed) if (e.backup) await unlink(e.backup).catch(() => {});
    });
  }

  /** Shape check; backups must live directly in our own backup folder. */
  private isEntry(e: unknown): e is UndoEntry {
    const x = e as Partial<UndoEntry> | null;
    return (
      typeof x === "object" &&
      x !== null &&
      typeof x.id === "string" &&
      typeof x.file === "string" &&
      typeof x.afterHash === "string" &&
      typeof x.at === "number" &&
      typeof x.label === "string" &&
      (x.backup === null ||
        (typeof x.backup === "string" && dirname(resolve(x.backup)) === this.backupDir))
    );
  }
}
