import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { ZipEntry } from "../../core/zip";
import { redactArgs, redactText, redactUrl } from "../setup/redact";

/**
 * A "brain": the parts of a Claude Code setup worth carrying to another computer
 * (CLAUDE.md, settings, skills, commands, agents, MCP servers), as one zip.
 * Secrets stay behind: settings' `env` is left out and MCP env and header values
 * are blanked. Chats, credentials and account data are never read.
 */
export type BrainScope = "user" | "project" | "both";
export type BrainPart = "user" | "project";

const APP = "orbit-brain";
const MAX_FILE = 1024 * 1024;
const MAX_TOTAL = 50 * 1024 * 1024;
const MAX_DEPTH = 8;
const FOLDERS = ["skills", "commands", "agents"];
/** Files that usually hold keys: never packed. */
const SECRET_FILE =
  /^\.env(\..*)?$|\.(pem|key|p12|pfx|keystore)$|^(\.npmrc|\.netrc|credentials(\..*)?|secrets?(\..*)?)$/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Text that survives a UTF-8 round trip and has no NUL bytes; null for anything else. */
function asText(buf: Buffer): string | null {
  if (buf.includes(0)) return null;
  const t = buf.toString("utf8");
  return Buffer.from(t, "utf8").equals(buf) ? t : null;
}

const toPosix = (p: string) => p.split(sep).join("/");

class Packer {
  entries: ZipEntry[] = [];
  left: string[] = [];
  private total = 0;

  add(name: string, text: string) {
    const data = Buffer.from(text, "utf8");
    if (this.total + data.length > MAX_TOTAL) {
      this.left.push(`${name} (the brain reached its size limit)`);
      return;
    }
    this.total += data.length;
    this.entries.push({ name, data });
  }

  /** A text file, if it's a regular file (not a link) and small enough. */
  async file(path: string, name: string) {
    const st = await lstat(path).catch(() => null);
    if (!st?.isFile()) return;
    if (st.size > MAX_FILE) {
      this.left.push(`${name} (larger than 1 MB)`);
      return;
    }
    const text = asText(await readFile(path));
    if (text === null) this.left.push(`${name} (not a text file)`);
    else this.add(name, text);
  }

  /** Every text file in a folder, never through links. */
  async folder(dir: string, prefix: string, depth = 0): Promise<void> {
    if (depth > MAX_DEPTH) return;
    const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) await this.folder(p, `${prefix}/${e.name}`, depth + 1);
      else if (e.isFile() && SECRET_FILE.test(e.name))
        this.left.push(`${prefix}/${e.name} (it may hold keys)`);
      else if (e.isFile()) await this.file(p, `${prefix}/${e.name}`);
    }
  }

  /** A settings file without `env`, which often holds keys and tokens. */
  async settings(path: string, name: string) {
    const raw = await readFile(path, "utf8").catch(() => null);
    if (raw === null) return;
    let o: unknown;
    try {
      o = JSON.parse(raw);
    } catch {
      this.left.push(`${name} (not valid JSON)`);
      return;
    }
    if (!isObj(o)) return;
    if ("env" in o) {
      delete o.env;
      this.left.push(`${name}: env (it can hold keys and tokens)`);
    }
    this.add(name, `${JSON.stringify(o, null, 2)}\n`);
  }
}

/** MCP servers with env and header values blanked; the names of those that had some. */
function blankSecrets(servers: Obj): { servers: Obj; blanked: string[] } {
  const out: Obj = {};
  const blanked: string[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    if (!isObj(raw)) continue;
    const s: Obj = structuredClone(raw);
    let had = false;
    for (const k of ["env", "headers"]) {
      const v = s[k];
      if (isObj(v) && Object.keys(v).length) {
        s[k] = Object.fromEntries(Object.keys(v).map((key) => [key, ""]));
        had = true;
      }
    }
    // Keys also hide in arguments (--api-key x) and addresses (?token=x).
    const before = JSON.stringify([s.command, s.args, s.url]);
    if (typeof s.command === "string") s.command = redactText(s.command);
    if (Array.isArray(s.args))
      s.args = redactArgs(s.args.filter((a): a is string => typeof a === "string"));
    if (typeof s.url === "string") s.url = redactUrl(s.url);
    if (JSON.stringify([s.command, s.args, s.url]) !== before) had = true;
    if (had) blanked.push(name);
    out[name] = s;
  }
  return { servers: out, blanked };
}

async function readJson(path: string): Promise<Obj | null> {
  try {
    const o: unknown = JSON.parse(await readFile(path, "utf8"));
    return isObj(o) ? o : null;
  } catch {
    return null;
  }
}

export async function collectBrain(o: {
  home: string;
  claudeJson: string;
  workspace: string | null;
  scope: BrainScope;
}): Promise<{ entries: ZipEntry[]; left: string[] }> {
  const p = new Packer();
  if (o.scope !== "project") {
    await p.file(join(o.home, "CLAUDE.md"), "user/CLAUDE.md");
    await p.settings(join(o.home, "settings.json"), "user/settings.json");
    for (const f of FOLDERS) await p.folder(join(o.home, f), `user/${f}`);
    const servers = (await readJson(o.claudeJson))?.mcpServers;
    if (isObj(servers) && Object.keys(servers).length) {
      const b = blankSecrets(servers);
      p.add("user/mcpServers.json", `${JSON.stringify(b.servers, null, 2)}\n`);
      if (b.blanked.length)
        p.left.push(`Secret values of MCP servers ${b.blanked.join(", ")} (fill them in again)`);
    }
  }
  if (o.scope !== "user" && o.workspace) {
    const ws = o.workspace;
    await p.file(join(ws, "CLAUDE.md"), "project/CLAUDE.md");
    const mcp = await readJson(join(ws, ".mcp.json"));
    if (mcp) {
      const servers = isObj(mcp.mcpServers) ? blankSecrets(mcp.mcpServers) : null;
      if (servers?.blanked.length)
        p.left.push(`Secret values in .mcp.json for ${servers.blanked.join(", ")}`);
      p.add(
        "project/.mcp.json",
        `${JSON.stringify(servers ? { ...mcp, mcpServers: servers.servers } : mcp, null, 2)}\n`,
      );
    }
    await p.settings(join(ws, ".claude", "settings.json"), "project/.claude/settings.json");
    for (const f of FOLDERS) await p.folder(join(ws, ".claude", f), `project/.claude/${f}`);
  }
  const manifest = {
    app: APP,
    version: 1,
    created: new Date().toISOString(),
    scope: o.scope,
    files: p.entries.length,
    leftOut: p.left,
  };
  return {
    entries: [
      { name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
      ...p.entries,
    ],
    left: p.left,
  };
}

export interface BrainFile {
  name: string;
  text: string;
}

const SAFE_NAME = /^(user|project)\/[^\0\\:*?"<>|]{1,400}$/;
/** Only what an export writes: anything else in a zip is refused. */
const BRAIN_FILE =
  /^user\/(CLAUDE\.md|settings\.json|mcpServers\.json|(skills|commands|agents)\/.+)$|^project\/(CLAUDE\.md|\.mcp\.json|\.claude\/settings\.json|\.claude\/(skills|commands|agents)\/.+)$/;

/** A brain's files, checked: only `user/…` and `project/…` text files, no way out of those. */
export function readBrain(entries: ZipEntry[]): {
  files: BrainFile[];
  mcpServers: Obj;
  leftOut: string[];
} {
  const m = entries.find((e) => e.name === "manifest.json");
  let manifest: unknown = null;
  try {
    manifest = m ? JSON.parse(m.data.toString("utf8")) : null;
  } catch {}
  if (!isObj(manifest) || manifest.app !== APP)
    throw new Error("That file isn't an Orbit brain backup.");
  const files: BrainFile[] = [];
  let mcpServers: Obj = {};
  for (const e of entries) {
    if (e.name === "manifest.json" || e.name.endsWith("/")) continue;
    const parts = e.name.split("/");
    if (!SAFE_NAME.test(e.name) || parts.some((x) => x === ".." || x === "." || x === ""))
      throw new Error(`"${e.name}" in this backup isn't safe to write, so nothing was imported.`);
    if (!BRAIN_FILE.test(e.name) || SECRET_FILE.test(parts[parts.length - 1] ?? ""))
      throw new Error(
        `"${e.name}" isn't something a backup holds, so nothing was imported. Only import backups Orbit made.`,
      );
    const text = asText(e.data);
    if (text === null) continue;
    if (e.name === "user/mcpServers.json") {
      try {
        const o: unknown = JSON.parse(text);
        if (isObj(o)) mcpServers = o;
      } catch {}
      continue;
    }
    files.push({ name: e.name, text });
  }
  const leftOut = Array.isArray(manifest.leftOut)
    ? manifest.leftOut.filter((x): x is string => typeof x === "string")
    : [];
  return { files, mcpServers, leftOut };
}

export interface PlannedFile extends BrainFile {
  /** Absolute path it is written to. */
  target: string;
  exists: boolean;
}

/** Where each file of the brain goes on this computer, for the parts picked. */
export function planImport(
  brain: ReturnType<typeof readBrain>,
  to: { home: string; workspace: string | null },
  parts: BrainPart[],
): { files: PlannedFile[]; mcpServers: Obj; skipped: string[] } {
  const files: PlannedFile[] = [];
  const skipped: string[] = [];
  for (const f of brain.files) {
    const [part, ...rest] = f.name.split("/");
    if (!parts.includes(part as BrainPart)) continue;
    const base = part === "user" ? to.home : to.workspace;
    if (!base) {
      if (!skipped.length) skipped.push("Open a folder to bring in the project files.");
      continue;
    }
    const target = resolve(base, ...rest);
    const root = resolve(base);
    if (!target.startsWith(root + sep) || toPosix(relative(root, target)).startsWith(".."))
      continue;
    files.push({ ...f, target, exists: existsSync(target) });
  }
  return { files, mcpServers: parts.includes("user") ? brain.mcpServers : {}, skipped };
}
