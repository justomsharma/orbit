import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./safeWriter";

const NAME = /^[a-z0-9-]+\.json$/;

function checkName(name: string): void {
  if (!NAME.test(name)) throw new Error(`Invalid Orbit store name: ${JSON.stringify(name)}`);
}

/** Orbit's own JSON files (pins, tags, usage index…), kept flat in Orbit's storage folder. */
export class OrbitStore {
  constructor(private readonly dir: string) {}

  /** The stored value, or `fallback` when the file is missing, not a regular file, or corrupt. */
  async read<T>(name: string, fallback: T): Promise<T> {
    checkName(name);
    const p = join(this.dir, name);
    try {
      if (!(await lstat(p)).isFile()) return fallback;
      return JSON.parse(await readFile(p, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  /** Replaces the file atomically (temp file + rename), creating the folder if needed. */
  async write(name: string, value: unknown): Promise<void> {
    checkName(name);
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(join(this.dir, name), JSON.stringify(value));
  }
}
