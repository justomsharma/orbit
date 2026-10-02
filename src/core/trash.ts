import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { renameWithRetry, writeFileAtomic } from "./safeWriter";

/** Something Orbit moved out of the way instead of deleting it. */
export interface TrashEntry {
  id: string;
  /** Where it was, and goes back to. */
  original: string;
  /** Where it is kept now. */
  stored: string;
  at: number;
  label: string;
}

const errCode = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code;

/** Every file under `dir` (or `dir` itself if it's a file), relative path → size. */
async function inventory(p: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const walk = async (cur: string) => {
    const st = await lstat(cur);
    if (st.isDirectory()) for (const name of await readdir(cur)) await walk(join(cur, name));
    else out.set(relative(p, cur), st.size);
  };
  await walk(p);
  return out;
}

const same = (a: Map<string, number>, b: Map<string, number>) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/** The file operations a move uses (swapped in tests to act out other drives and open files). */
export interface TrashOps {
  rename(from: string, to: string): Promise<void>;
  /** Removes a file or folder tree; `real` is the plain removal. */
  removeTree(path: string, real: (p: string) => Promise<void>): Promise<void>;
}

const realRemove = (p: string) => rm(p, { recursive: true });
const DEFAULT_OPS: TrashOps = {
  rename: (from, to) => renameWithRetry(from, to),
  removeTree: (p, real) => real(p),
};

/**
 * Moves a file or folder, also across drives: a copy is checked file by file
 * before the original is removed. If the original can't be removed completely
 * (a file is open, say), whatever went is copied back and the copy dropped, so
 * nothing ends up half gone.
 */
async function move(from: string, to: string, ops: TrashOps): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await ops.rename(from, to);
    return;
  } catch (e) {
    if (errCode(e) !== "EXDEV") throw e;
  }
  await cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  if (!same(await inventory(from), await inventory(to))) {
    await rm(to, { recursive: true, force: true });
    throw new Error(`Couldn't copy ${basename(from)} completely, so it was left where it is.`);
  }
  try {
    await ops.removeTree(from, realRemove);
  } catch (e) {
    // Put back what was already removed (keeping anything still there), then drop the copy.
    await cp(to, from, {
      recursive: true,
      force: false,
      errorOnExist: false,
      verbatimSymlinks: true,
    });
    await rm(to, { recursive: true, force: true });
    throw new Error(
      `Couldn't move ${basename(from)} (a file in it may be open), so nothing was deleted. ${errCode(e) ?? ""}`.trim(),
    );
  }
}

/**
 * Orbit's trash: deleting a skill, agent, command or memory moves it here, and
 * Undo (or Settings history) puts it back. Nothing is removed for good unless
 * the person asks.
 */
export class Trash {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now,
    private readonly ops: TrashOps = DEFAULT_OPS,
  ) {}

  private get logFile() {
    return join(this.root, "log.json");
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private async read(): Promise<TrashEntry[]> {
    try {
      const v: unknown = JSON.parse(await readFile(this.logFile, "utf8"));
      return Array.isArray(v) ? (v as TrashEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async write(all: TrashEntry[]): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFileAtomic(this.logFile, JSON.stringify(all, null, 2));
  }

  /** Moves `path` into the trash. Refuses links (only the link would go) and missing paths. */
  put(path: string, label: string): Promise<TrashEntry> {
    return this.serial(async () => {
      const original = resolve(path);
      let st: Awaited<ReturnType<typeof lstat>>;
      try {
        st = await lstat(original);
      } catch {
        throw new Error(`${basename(original)} isn't there any more.`);
      }
      if (st.isSymbolicLink())
        throw new Error(
          `${basename(original)} is a link to another folder; remove the link yourself.`,
        );
      const id = randomUUID();
      const stored = join(this.root, id, basename(original));
      await move(original, stored, this.ops);
      const entry: TrashEntry = { id, original, stored, at: this.now(), label };
      try {
        await this.write([...(await this.read()), entry]);
      } catch (e) {
        // Without its log entry it couldn't be restored: put it back now.
        await move(stored, original, this.ops);
        await rm(join(this.root, id), { recursive: true, force: true });
        throw e;
      }
      return entry;
    });
  }

  /** Puts it back where it was, unless something new is there now. */
  restore(id: string): Promise<void> {
    return this.serial(async () => {
      const all = await this.read();
      const e = all.find((x) => x.id === id);
      if (!e) throw new Error("Orbit no longer has that in its trash.");
      const taken = await lstat(e.original).then(
        () => true,
        () => false,
      );
      if (taken)
        throw new Error(
          `There's already a ${basename(e.original)} there, so Orbit left both as they are.`,
        );
      await move(e.stored, e.original, this.ops);
      await rm(join(this.root, e.id), { recursive: true, force: true });
      await this.write(all.filter((x) => x.id !== id));
    });
  }

  /** Removes an entry for good. */
  forget(id: string): Promise<void> {
    return this.serial(async () => {
      const all = await this.read();
      if (!all.some((x) => x.id === id)) return;
      await rm(join(this.root, id), { recursive: true, force: true });
      await this.write(all.filter((x) => x.id !== id));
    });
  }

  /** What's in the trash, newest first. */
  list(): Promise<TrashEntry[]> {
    return this.serial(async () => (await this.read()).reverse());
  }
}
