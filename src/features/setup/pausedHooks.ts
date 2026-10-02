import { randomUUID } from "node:crypto";
import type { OrbitStore } from "../../core/orbitStore";
import { normPath } from "../../core/paths";
import type { HookEntry } from "./hooks";

/**
 * A hook Orbit took out of a settings file to pause it, kept exactly as written
 * so resuming puts back the same thing. Kept in Orbit's own storage: Claude's
 * settings files never get keys Claude doesn't know.
 */
export interface PausedHook {
  id: string;
  scope: "user" | "project" | "local";
  source: string;
  event: string;
  matcher: string | null;
  handler: Record<string, unknown>;
  at: number;
}

/** What the view shows for a paused hook. */
export interface PausedHookView {
  id: string;
  scope: PausedHook["scope"];
  source: string;
  event: string;
  matcher: string | null;
  type: string;
  command: string | null;
  url: string | null;
  timeout: number | null;
  at: number;
}

export interface PausedStore {
  list(): Promise<PausedHook[]>;
  add(h: Omit<PausedHook, "id" | "at">): Promise<PausedHook>;
  remove(id: string): Promise<void>;
}

const FILE = "paused-hooks.json";
const MAX = 200;

export class PausedHooks implements PausedStore {
  constructor(
    private readonly store: Pick<OrbitStore, "read" | "write">,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<PausedHook[]> {
    const v = await this.store.read<unknown>(FILE, []);
    return Array.isArray(v) ? (v as PausedHook[]) : [];
  }

  async add(h: Omit<PausedHook, "id" | "at">): Promise<PausedHook> {
    const all = await this.list();
    if (all.length >= MAX)
      throw new Error(`Orbit keeps at most ${MAX} paused hooks. Resume or remove some first.`);
    const entry: PausedHook = { ...h, id: randomUUID(), at: this.now() };
    await this.store.write(FILE, [...all, entry]);
    return entry;
  }

  async remove(id: string): Promise<void> {
    await this.store.write(
      FILE,
      (await this.list()).filter((h) => h.id !== id),
    );
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * The active hook is the paused handler, put back. Only told apart by command or
 * address; hooks without either (prompt, agent) never count as the same.
 */
export function isSameHook(
  h: Pick<HookEntry, "type" | "command" | "url">,
  handler: Record<string, unknown>,
): boolean {
  if (h.type !== (str(handler.type) ?? "command")) return false;
  const command = str(handler.command);
  const url = str(handler.url);
  if (command !== null) return h.command === command;
  if (url !== null) return h.url === url;
  return false;
}

/**
 * Paused hooks from the settings files this window shows, leaving out any that
 * are back in their file already (put back by an Undo, say).
 */
export function pausedFor(
  all: PausedHook[],
  files: string[],
  active: HookEntry[],
  platform: NodeJS.Platform,
): PausedHookView[] {
  const key = (p: string) => normPath(p, platform);
  const shown = new Set(files.map(key));
  return all
    .filter((p) => shown.has(key(p.source)))
    .filter(
      (p) =>
        !active.some(
          (h) =>
            key(h.source) === key(p.source) &&
            h.event === p.event &&
            h.matcher === p.matcher &&
            isSameHook(h, p.handler),
        ),
    )
    .map((p) => ({
      id: p.id,
      scope: p.scope,
      source: p.source,
      event: p.event,
      matcher: p.matcher,
      type: str(p.handler.type) ?? "command",
      command: str(p.handler.command),
      url: str(p.handler.url),
      timeout: typeof p.handler.timeout === "number" ? p.handler.timeout : null,
      at: p.at,
    }));
}
