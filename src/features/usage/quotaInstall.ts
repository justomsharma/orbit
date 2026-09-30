import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { obj, str } from "../../core/jsonl";
import { OrbitStore } from "../../core/orbitStore";
import { ConflictError, type SafeWriter, UnparseableError } from "../../core/safeWriter";
import type { QuotaFile } from "../../tap/statusline";

const TAP = "statusline-tap.js";
const INNER = "statusline-inner.json";
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
}

interface InstallState {
  enabled: boolean;
  command: string | null;
  /** The person's statusLine before Orbit's, restored on turn-off. */
  previous: Record<string, unknown> | null;
}

export type QuotaResult =
  | { ok: true }
  | { ok: false; reason: "no-node" | "unparseable" | "conflict" };

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The statusline command. On Windows Claude runs it through Git Bash or
 * PowerShell; a bare `node` with a double-quoted forward-slash path works in both.
 */
export function tapCommand(nodePath: string, tapPath: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return `node "${tapPath.replace(/\\/g, "/")}"`;
  return `${shQuote(nodePath)} ${shQuote(tapPath)}`;
}

/** Turns Orbit's plan-limit tracking on and off by managing Claude Code's `statusLine` setting. */
export class QuotaInstaller {
  constructor(private readonly d: QuotaDeps) {}

  private get tapPath(): string {
    return `${this.d.tapDir}/${TAP}`.replace(/[\\/]+/g, this.d.platform === "win32" ? "\\" : "/");
  }

  private isOurs(statusLine: unknown): boolean {
    const cmd = str(obj(statusLine)?.command) ?? "";
    return cmd.includes(TAP) && cmd.replace(/\\/g, "/").includes(basename(this.d.tapDir));
  }

  private async currentStatusLine(): Promise<unknown> {
    try {
      return obj(JSON.parse(await readFile(this.d.settingsPath, "utf8")))?.statusLine;
    } catch {
      return undefined;
    }
  }

  private tapStore(): OrbitStore {
    return new OrbitStore(this.d.tapDir);
  }

  async status(): Promise<{ enabled: boolean }> {
    const st = await this.d.store.read<InstallState | null>(STATE, null);
    return { enabled: Boolean(st?.enabled) && this.isOurs(await this.currentStatusLine()) };
  }

  async enable(): Promise<QuotaResult> {
    const node = await this.d.findNode();
    if (!node) return { ok: false, reason: "no-node" };
    const tap = this.tapStore();
    await tap.writeText(TAP, await readFile(this.d.tapSource, "utf8"));
    const command = tapCommand(node, this.tapPath, this.d.platform);
    let previous: Record<string, unknown> | null = null;
    try {
      const plan = await this.d.writer.planJson(this.d.settingsPath, (s) => {
        const cur = obj(s.statusLine);
        const prevState = cur && !this.isOurs(cur) ? cur : null;
        previous = prevState;
        s.statusLine = { ...(cur ?? {}), type: "command", command };
      });
      if (previous === null) {
        const old = await this.d.store.read<InstallState | null>(STATE, null);
        // Re-enabling over our own entry: keep what we saved the first time.
        if (this.isOurs(await this.currentStatusLine())) previous = old?.previous ?? null;
      }
      const prevCmd = str(obj(previous)?.command);
      await tap.write(INNER, prevCmd ? { command: prevCmd } : {});
      await this.d.writer.apply(plan, "Turn on plan limits (Orbit)");
    } catch (e) {
      if (e instanceof UnparseableError) return { ok: false, reason: "unparseable" };
      if (e instanceof ConflictError) return { ok: false, reason: "conflict" };
      throw e;
    }
    await this.d.store.write(STATE, { enabled: true, command, previous } satisfies InstallState);
    return { ok: true };
  }

  async disable(): Promise<QuotaResult> {
    const st = await this.d.store.read<InstallState | null>(STATE, null);
    try {
      if (this.isOurs(await this.currentStatusLine())) {
        const plan = await this.d.writer.planJson(this.d.settingsPath, (s) => {
          if (st?.previous) s.statusLine = st.previous;
          else delete s.statusLine;
        });
        await this.d.writer.apply(plan, "Turn off plan limits (Orbit)");
      }
      // Otherwise the person replaced Orbit's statusline themselves: leave theirs alone.
    } catch (e) {
      if (e instanceof UnparseableError) return { ok: false, reason: "unparseable" };
      if (e instanceof ConflictError) return { ok: false, reason: "conflict" };
      throw e;
    }
    await this.tapStore().write(INNER, {});
    await this.d.store.write(STATE, {
      enabled: false,
      command: null,
      previous: null,
    } satisfies InstallState);
    return { ok: true };
  }

  /** The latest numbers the tap recorded, or null. */
  async readQuota(): Promise<QuotaFile | null> {
    const q = await this.tapStore().read<QuotaFile | null>("quota.json", null);
    return q && q.v === 1 ? q : null;
  }
}
