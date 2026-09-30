import { isSessionId } from "../core/uuid";

/** The subset of `vscode.Memento` Orbit uses (keeps this file testable without VS Code). */
export interface Memento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

const PINS = "orbit.pins";
const RENAMES = "orbit.renames";
const MAX_PINS = 500;
const MAX_RENAMES = 5000;

/**
 * Orbit's own per-user data. Lives in VS Code's extension storage — never in
 * `~/.claude` — so nothing here can affect Claude Code.
 */
export class OrbitState {
  constructor(private readonly store: Memento) {}

  pins(): string[] {
    const v = this.store.get<unknown>(PINS, []);
    return Array.isArray(v) ? v.filter(isSessionId) : [];
  }

  async setPin(id: string, on: boolean): Promise<void> {
    if (!isSessionId(id)) return;
    const rest = this.pins().filter((p) => p !== id);
    await this.store.update(PINS, on ? [id, ...rest].slice(0, MAX_PINS) : rest);
  }

  renames(): Record<string, string> {
    const v = this.store.get<unknown>(RENAMES, {});
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, t] of Object.entries(v)) if (isSessionId(k) && typeof t === "string") out[k] = t;
    return out;
  }

  async setRename(id: string, title: string): Promise<void> {
    if (!isSessionId(id)) return;
    const all = this.renames();
    const clean = title.trim().slice(0, 200);
    delete all[id];
    const next = clean ? { [id]: clean, ...all } : all;
    await this.store.update(
      RENAMES,
      Object.fromEntries(Object.entries(next).slice(0, MAX_RENAMES)),
    );
  }
}
