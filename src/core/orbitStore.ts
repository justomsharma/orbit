import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./safeWriter";

const NAME = /^[a-z0-9-]+\.json$/;
const TEXT_NAME = /^[a-z0-9-]+\.(json|js)$/;

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
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(join(this.dir, name), JSON.stringify(value), { mode: 0o600 });
  }

  /** Writes a small text file (e.g. Orbit's statusline tap script) into Orbit's folder. */
  async writeText(name: string, text: string): Promise<void> {
    if (!TEXT_NAME.test(name)) throw new Error(`Invalid Orbit store name: ${JSON.stringify(name)}`);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(join(this.dir, name), text);
  }

  /** Absolute path of a file in Orbit's folder. */
  path(name: string): string {
    if (!TEXT_NAME.test(name)) throw new Error(`Invalid Orbit store name: ${JSON.stringify(name)}`);
    return join(this.dir, name);
  }
}
