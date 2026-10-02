import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyJsonEdit, type ConfirmHost } from "../../core/applyEdit";
import { obj, str } from "../../core/jsonl";
import { OrbitStore } from "../../core/orbitStore";
import { type SafeWriter, SafeWriter as Writer } from "../../core/safeWriter";
import type { QuotaFile } from "../../tap/statusline";
import { managedSettingsPath } from "../setup/settings";

const TAP = "statusline-tap.js";
const INNER = "statusline-inner.json";
/** The person's statusLine before Orbit's — kept next to the tap so uninstall can restore it. */
const PREVIOUS = "previous.json";
const STATE = "quota-install.json";

export interface QuotaDeps {
  /** `~/.claude/settings.json`. */
  settingsPath: string;
  /** Orbit's own folder for the tap, its settings and quota.json. */
  tapDir: string;
  /** The bundled tap shipped with the extension. */
  tapSource: string;
  /** Orbit's main store (install state). */
  store: OrbitStore;
  writer: SafeWriter;
  findNode(): Promise<string | null>;
  platform: NodeJS.Platform;
  /** Asks before changing settings.json and offers the diff and Undo. */
  confirm: ConfirmHost;
  /** The open folder, to notice a project statusline that hides Orbit's there. */
  workspace(): string | null;
  /** The organisation's managed settings file (default: Claude Code's path for the platform). */
  managedPath?: string;
}

interface InstallState {
  enabled: boolean;
  command: string | null;
}

export type QuotaResult =
  | { ok: true }
  | { ok: false; reason: "no-node" | "not-applied" | "managed" };

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const slash = (s: string) => s.replace(/\\/g, "/");

/**
 * The statusline command. `node` is looked up on PATH each time Claude runs it,
 * so switching Node versions (nvm, fnm, Volta…) can't leave a dead path behind.
 * On Windows Claude runs it through Git Bash or PowerShell; a double-quoted
 * forward-slash path works in both.
 */
export function tapCommand(tapPath: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return `node "${slash(tapPath)}"`;
  return `node ${shQuote(tapPath)}`;
}

/** The tap folder named in a statusline command, if it is any Orbit tap. */
function tapDirIn(command: string): string | null {
  const m = slash(command).match(/["']([^"']*\/statusline-tap\.js)["']/);
  return m ? dirname(m[1]!) : null;
}

async function readJson(p: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}

/** Turns Orbit's plan-limit tracking on and off by managing Claude Code's `statusLine` setting. */
export class QuotaInstaller {
  constructor(private readonly d: QuotaDeps) {}

  private get tapPath(): string {
    return join(this.d.tapDir, TAP);
  }

  private same(a: string, b: string): boolean {
    const n = (s: string) => (this.d.platform === "win32" ? slash(s).toLowerCase() : slash(s));
    return n(a) === n(b);
  }

  /** Is this statusLine Orbit's tap from this install (not another editor's)? */
  private isOurs(statusLine: unknown): boolean {
    const dir = tapDirIn(str(obj(statusLine)?.command) ?? "");
    return dir !== null && this.same(dir, this.d.tapDir);
  }

  private async statusLineIn(file: string): Promise<unknown> {
    return obj(await readJson(file))?.statusLine;
  }

  private tapStore(): OrbitStore {
    return new OrbitStore(this.d.tapDir);
  }

  /** What the person had before any Orbit tap: ours, another editor's, or their own command. */
  private async previousOf(current: unknown): Promise<Record<string, unknown> | null> {
    const cur = obj(current);
    if (!cur) return null;
    const dir = tapDirIn(str(cur.command) ?? "");
    if (!dir) return cur;
    return obj(obj(await readJson(join(dir, PREVIOUS)))?.statusLine);
  }

  async status(): Promise<{ enabled: boolean; shadowed: boolean }> {
    const st = await this.d.store.read<InstallState | null>(STATE, null);
    const enabled =
      Boolean(st?.enabled) && this.isOurs(await this.statusLineIn(this.d.settingsPath));
    let shadowed = false;
    const ws = this.d.workspace();
    if (enabled && ws) {
      for (const f of ["settings.json", "settings.local.json"]) {
        const s = await this.statusLineIn(join(ws, ".claude", f));
        if (s !== undefined && !this.isOurs(s)) shadowed = true;
      }
    }
    return { enabled, shadowed };
  }

  async enable(): Promise<QuotaResult> {
    // Managed settings win over the person's, so Orbit's statusline would never run.
    const managed = this.d.managedPath ?? managedSettingsPath(this.d.platform);
    if ((await this.statusLineIn(managed)) !== undefined) return { ok: false, reason: "managed" };
    const node = await this.d.findNode();
    if (!node) return { ok: false, reason: "no-node" };
    const tap = this.tapStore();
    await tap.writeText(TAP, await readFile(this.d.tapSource, "utf8"));
    const command = tapCommand(this.tapPath, this.d.platform);
    const previous = await this.previousOf(await this.statusLineIn(this.d.settingsPath));

    // Record what to chain to and what to restore before switching over.
    const prevCmd = str(previous?.command);
    await tap.write(INNER, prevCmd ? { command: prevCmd } : {});
    await tap.write(PREVIOUS, { statusLine: previous });

    const applied = await applyJsonEdit(this.d.writer, this.d.confirm, {
      file: this.d.settingsPath,
      mutate: (s) => {
        const keep = { ...(previous ?? {}) };
        delete keep.command;
        s.statusLine = { ...keep, type: "command", command };
      },
      summary: previous
        ? "Show your plan limits in Orbit? Orbit will set Claude Code's statusline to a small helper that records them, then runs your own statusline exactly as before."
        : "Show your plan limits in Orbit? Orbit will set Claude Code's statusline to a small helper that records them and shows the model and context.",
      label: "Turn on plan limits",
    });
    if (!applied) return { ok: false, reason: "not-applied" };
    await this.d.store.write(STATE, { enabled: true, command } satisfies InstallState);
    return { ok: true };
  }

  async disable(): Promise<QuotaResult> {
    if (this.isOurs(await this.statusLineIn(this.d.settingsPath))) {
      const saved = obj(obj(await readJson(join(this.d.tapDir, PREVIOUS)))?.statusLine);
      const applied = await applyJsonEdit(this.d.writer, this.d.confirm, {
        file: this.d.settingsPath,
        mutate: (s) => {
          if (saved) s.statusLine = saved;
          else delete s.statusLine;
        },
        summary: saved
          ? "Turn off plan limits and put your previous statusline back?"
          : "Turn off plan limits and remove Orbit's statusline helper?",
        label: "Turn off plan limits",
      });
      if (!applied) return { ok: false, reason: "not-applied" };
    }
    // Otherwise the person replaced Orbit's statusline themselves: leave theirs alone.
    await this.tapStore().write(INNER, {});
    await this.d.store.write(STATE, { enabled: false, command: null } satisfies InstallState);
    return { ok: true };
  }

  /** Re-copies the bundled tap (after an Orbit update) while plan limits are on. */
  async syncTap(): Promise<void> {
    if (!(await this.status()).enabled) return;
    await this.tapStore().writeText(TAP, await readFile(this.d.tapSource, "utf8"));
  }

  /** The latest numbers the tap recorded, or null. */
  async readQuota(): Promise<QuotaFile | null> {
    const q = await this.tapStore().read<QuotaFile | null>("quota.json", null);
    return q && q.v === 1 ? q : null;
  }
}

/**
 * Run when Orbit is uninstalled: if Claude's statusline still points at an Orbit
 * tap, put back what the person had before (or remove the entry), so Claude never
 * runs a helper that no longer exists.
 */
export async function restoreOnUninstall(settingsPath: string, backupDir: string): Promise<void> {
  const current = obj(obj(await readJson(settingsPath))?.statusLine);
  const dir = tapDirIn(str(current?.command) ?? "");
  if (!dir) return;
  const saved = obj(obj(await readJson(join(dir, PREVIOUS)))?.statusLine);
  const writer = new Writer(backupDir);
  const plan = await writer.planJson(settingsPath, (s) => {
    if (saved) s.statusLine = saved;
    else delete s.statusLine;
  });
  await writer.apply(plan, "Orbit uninstalled: restore statusline");
}
