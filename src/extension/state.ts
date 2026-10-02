import { isSessionId } from "../core/uuid";
import { isStep, type Onboarding, type Step } from "../shared/onboarding";

/** The subset of `vscode.Memento` Orbit uses (keeps this file testable without VS Code). */
export interface Memento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

const PINS = "orbit.pins";
const RENAMES = "orbit.renames";
const MAX_PINS = 500;
const MAX_RENAMES = 5000;
const TAGS = "orbit.tags";
const ONBOARDING = "orbit.onboarding";
const MAX_TAGGED = 5000;
const MAX_TAGS = 8;
const MAX_MARKED = 5000;

export type ChatSet = "archived" | "hidden" | "temp";
const SETS: Record<ChatSet, string> = {
  archived: "orbit.archived",
  hidden: "orbit.hidden",
  temp: "orbit.temp",
};

/** `#Big Refactor` → `big-refactor`: lowercase letters, digits, - and _, up to 24 long. */
export function cleanTag(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .slice(0, 24);
}

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

  /** Chats in a named set: archived (out of the main list) or hidden (Orbit's "delete"). */
  marked(set: ChatSet): string[] {
    const v = this.store.get<unknown>(SETS[set], []);
    return Array.isArray(v) ? v.filter(isSessionId) : [];
  }

  /** Adds or removes chats from a set. Archiving or hiding a chat also unpins it. */
  async mark(set: ChatSet, ids: string[], on: boolean): Promise<void> {
    const valid = ids.filter(isSessionId);
    if (!valid.length) return;
    const drop = new Set(valid);
    const rest = this.marked(set).filter((x) => !drop.has(x));
    await this.store.update(SETS[set], on ? [...valid, ...rest].slice(0, MAX_MARKED) : rest);
    if (on && set !== "temp") {
      const pins = this.pins().filter((p) => !drop.has(p));
      await this.store.update(PINS, pins);
    }
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

  /** Tags per chat, kept only in Orbit (Claude never sees them). */
  tags(): Record<string, string[]> {
    const v = this.store.get<unknown>(TAGS, {});
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, t] of Object.entries(v)) {
      if (!isSessionId(k) || !Array.isArray(t)) continue;
      const list = t.filter((x): x is string => typeof x === "string");
      if (list.length) out[k] = list;
    }
    return out;
  }

  async setTags(id: string, tags: string[]): Promise<void> {
    if (!isSessionId(id)) return;
    const clean = [...new Set(tags.map(cleanTag).filter(Boolean))].slice(0, MAX_TAGS);
    const all = this.tags();
    delete all[id];
    const next = clean.length ? { [id]: clean, ...all } : all;
    await this.store.update(TAGS, Object.fromEntries(Object.entries(next).slice(0, MAX_TAGGED)));
  }

  /** Getting-started progress (kept across restarts). */
  onboarding(): Onboarding {
    const v = this.store.get<unknown>(ONBOARDING, {});
    const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const done = Array.isArray(o.done) ? [...new Set(o.done.filter(isStep))] : [];
    return { done, dismissed: o.dismissed === true, welcomed: o.welcomed === true };
  }

  async markWelcomed(): Promise<void> {
    await this.store.update(ONBOARDING, { ...this.onboarding(), welcomed: true });
  }

  /** Marks a step done. True when it was new. */
  async markStep(step: Step): Promise<boolean> {
    if (!isStep(step)) return false;
    const cur = this.onboarding();
    if (cur.done.includes(step)) return false;
    await this.store.update(ONBOARDING, { ...cur, done: [...cur.done, step] });
    return true;
  }

  async dismissOnboarding(): Promise<void> {
    await this.store.update(ONBOARDING, { ...this.onboarding(), dismissed: true });
  }
}
