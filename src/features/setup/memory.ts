import * as os from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mapLimit } from "../../core/concurrency";
import { listDirSafe, readTextSafe, statSafe } from "../../core/fsSafe";
import { MAX_FILE_BYTES, PARALLEL, strOrNull } from "./content";
import { parseFrontmatter } from "./frontmatter";

export interface ClaudeMdFile {
  scope: "user" | "project" | "project-dir" | "local" | "managed";
  path: string;
  exists: boolean;
  bytes: number;
  imports: { ref: string; path: string; exists: boolean }[];
}

export interface MemoryFile {
  name: string;
  path: string;
  bytes: number;
  title: string | null;
  description: string | null;
  links: string[];
  brokenLinks: string[];
  orphan: boolean;
}

export interface MemoryInfo {
  claudeMd: ClaudeMdFile[];
  auto: {
    enabled: boolean;
    dir: string;
    indexPath: string | null;
    indexLines: number;
    indexBytes: number;
    files: MemoryFile[];
  };
}

export interface MemoryOpts {
  /** Claude's home (`~/.claude`). */
  home: string;
  workspace: string | null;
  settings: { autoMemoryEnabled?: unknown; autoMemoryDirectory?: unknown };
  platform?: NodeJS.Platform;
  /** The person's home folder, for `~` in paths. Defaults to `os.homedir()`. */
  userHome?: string;
}

const INDEX = "MEMORY.md";

/** Organisation-wide CLAUDE.md, set by an administrator. */
export function managedClaudeMdPath(platform: NodeJS.Platform): string {
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\CLAUDE.md";
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/CLAUDE.md";
  return "/etc/claude-code/CLAUDE.md";
}

function expandHome(p: string, userHome: string): string {
  if (p === "~") return userHome;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(userHome, p.slice(2));
  return p;
}

/**
 * `@path` imports in a CLAUDE.md. The `@` must start a word (so emails don't
 * count), and code blocks and inline code are skipped, as Claude Code does.
 */
export function importRefs(text: string): string[] {
  const refs = new Set<string>();
  let fence: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const marker = raw.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0]!;
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const line = raw.replace(/`[^`]*`/g, " ");
    for (const m of line.matchAll(/(?:^|\s)@([\w./~-]+)/g)) {
      const ref = m[1]!.replace(/\.+$/, "");
      if (ref) refs.add(ref);
    }
  }
  return [...refs];
}

async function readClaudeMd(
  scope: ClaudeMdFile["scope"],
  path: string,
  userHome: string,
): Promise<ClaudeMdFile> {
  const st = await statSafe(path);
  const file: ClaudeMdFile = { scope, path, exists: st !== null, bytes: 0, imports: [] };
  if (!st?.isFile()) return file;
  file.bytes = st.size;
  const text = await readTextSafe(path, MAX_FILE_BYTES);
  if (text === null) return file;
  for (const ref of importRefs(text)) {
    const home = expandHome(ref, userHome);
    const target = home !== ref || isAbsolute(ref) ? home : resolve(dirname(path), ref);
    file.imports.push({ ref, path: target, exists: (await statSafe(target)) !== null });
  }
  return file;
}

function claudeMdCandidates(o: MemoryOpts, platform: NodeJS.Platform) {
  const c: [ClaudeMdFile["scope"], string][] = [["user", join(o.home, "CLAUDE.md")]];
  if (o.workspace)
    c.push(
      ["project", join(o.workspace, "CLAUDE.md")],
      ["project-dir", join(o.workspace, ".claude", "CLAUDE.md")],
      ["local", join(o.workspace, "CLAUDE.local.md")],
    );
  c.push(["managed", managedClaudeMdPath(platform)]);
  return c;
}

/** Claude's per-project folder name: every non-alphanumeric character becomes `-`. */
export const projectSlug = (workspace: string) => workspace.replace(/[^a-zA-Z0-9]/g, "-");

function autoMemoryDir(o: MemoryOpts, userHome: string): string {
  const custom = strOrNull(o.settings.autoMemoryDirectory);
  if (custom) {
    const p = expandHome(custom, userHome);
    return isAbsolute(p) ? join(p) : resolve(o.workspace ?? userHome, p);
  }
  return o.workspace ? join(o.home, "projects", projectSlug(o.workspace), "memory") : "";
}

/** `[[target]]` links, also `[[target|label]]` and `[[target#part]]`. */
export function wikiLinks(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\[\[([^[\]\n|#]+)(?:[|#][^\]\n]*)?\]\]/g)) {
    const t = m[1]!.trim();
    if (t) out.add(t);
  }
  return [...out];
}

/** File names that Markdown links like `[x](file.md)` point at, lower-cased. */
function linkedFiles(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\]\(<?([^)\s>]+)>?\)/g)) {
    let t = m[1]!.split("#")[0]!;
    try {
      t = decodeURIComponent(t);
    } catch {}
    const base = t.split(/[\\/]/).pop();
    if (base) out.add(base.toLowerCase());
  }
  return out;
}

const countLines = (t: string) => (t ? t.split("\n").length - (t.endsWith("\n") ? 1 : 0) : 0);

interface Raw {
  name: string;
  path: string;
  bytes: number;
  stem: string;
  title: string | null;
  description: string | null;
  links: string[];
}

async function readMemoryFile(dir: string, name: string): Promise<Raw> {
  const path = join(dir, name);
  const stem = name.slice(0, -3);
  const bytes = (await statSafe(path))?.size ?? 0;
  const text = await readTextSafe(path, MAX_FILE_BYTES);
  if (text === null) return { name, path, bytes, stem, title: stem, description: null, links: [] };
  const fm = parseFrontmatter(text);
  return {
    name,
    path,
    bytes,
    stem,
    title: strOrNull(fm.data.name) ?? stem,
    description: strOrNull(fm.data.description),
    links: wikiLinks(fm.body),
  };
}

async function readAuto(dir: string): Promise<Omit<MemoryInfo["auto"], "enabled" | "dir">> {
  const none = { indexPath: null, indexLines: 0, indexBytes: 0, files: [] };
  if (!dir) return none;
  const indexPath = join(dir, INDEX);
  const indexSt = await statSafe(indexPath);
  const hasIndex = !!indexSt?.isFile();
  const indexText = hasIndex ? ((await readTextSafe(indexPath, MAX_FILE_BYTES)) ?? "") : "";
  const names = (await listDirSafe(dir))
    .filter((e) => e.isFile() && /\.md$/i.test(e.name) && e.name.toLowerCase() !== "memory.md")
    .map((e) => e.name)
    .sort();
  const raws = await mapLimit(names, PARALLEL, (n) => readMemoryFile(dir, n));

  // Which memory a `[[link]]` names: its frontmatter name, file stem or file name.
  const owner = new Map<string, Raw>();
  for (const r of raws)
    for (const k of [r.name, r.stem, r.title ?? r.stem]) owner.set(k.toLowerCase(), r);
  const target = (link: string) => owner.get(link.toLowerCase());

  const referenced = new Set<Raw>();
  const indexFiles = linkedFiles(indexText);
  for (const r of raws) if (indexFiles.has(r.name.toLowerCase())) referenced.add(r);
  for (const l of wikiLinks(indexText)) {
    const t = target(l);
    if (t) referenced.add(t);
  }
  for (const r of raws)
    for (const l of r.links) {
      const t = target(l);
      if (t && t !== r) referenced.add(t);
    }

  return {
    indexPath: hasIndex ? indexPath : null,
    indexLines: countLines(indexText),
    indexBytes: hasIndex ? (indexSt?.size ?? 0) : 0,
    files: raws.map((r) => ({
      name: r.name,
      path: r.path,
      bytes: r.bytes,
      title: r.title,
      description: r.description,
      links: r.links,
      brokenLinks: r.links.filter((l) => !target(l)),
      orphan: !referenced.has(r),
    })),
  };
}

/** Every CLAUDE.md that could apply here, plus this project's auto memory. */
export async function readMemory(opts: MemoryOpts): Promise<MemoryInfo> {
  const platform = opts.platform ?? process.platform;
  const userHome = opts.userHome ?? os.homedir();
  const claudeMd = await Promise.all(
    claudeMdCandidates(opts, platform).map(([scope, p]) =>
      readClaudeMd(scope, p, userHome).catch(
        (): ClaudeMdFile => ({ scope, path: p, exists: false, bytes: 0, imports: [] }),
      ),
    ),
  );
  const dir = autoMemoryDir(opts, userHome);
  const auto = await readAuto(dir).catch(() => ({
    indexPath: null,
    indexLines: 0,
    indexBytes: 0,
    files: [],
  }));
  return { claudeMd, auto: { enabled: opts.settings.autoMemoryEnabled !== false, dir, ...auto } };
}
