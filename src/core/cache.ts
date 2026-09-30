interface Entry<T> {
  mtimeMs: number;
  size: number;
  value: T;
}

/** Small LRU cache whose entries are valid only while a file's mtime and size are unchanged. */
export class MtimeCache<T> {
  private readonly map = new Map<string, Entry<T>>();

  constructor(private readonly capacity = 5000) {}

  get(key: string, mtimeMs: number, size: number): T | undefined {
    const e = this.map.get(key);
    if (!e || e.mtimeMs !== mtimeMs || e.size !== size) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, mtimeMs: number, size: number, value: T): void {
    this.map.delete(key);
    this.map.set(key, { mtimeMs, size, value });
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}
