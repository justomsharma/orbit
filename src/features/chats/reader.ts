import { basename, join } from "node:path";
import type { MtimeCache } from "../../core/cache";
import { mapLimit } from "../../core/concurrency";
import { type HeadTail, listDirSafe, readHeadTail, statSafe } from "../../core/fsSafe";
import { forEachJsonLine, type JsonObject, obj, str } from "../../core/jsonl";
import { streamJsonLines } from "../../core/lines";
import { projectName, projectsDir } from "../../core/paths";
import { isSessionId } from "../../core/uuid";
import type { Session } from "./types";

const MAX_PROMPT = 300;
const MAX_TITLE = 200;
const PARALLEL = 32;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Text of a person's prompt, or null for meta lines, tool results and command wrappers. */
export function promptText(line: JsonObject): string | null {
  if (line.type !== "user" || line.isMeta === true || line.isSidechain === true) return null;
  const content = obj(line.message)?.content;
  let text: string | null = null;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    if (content.some((b) => obj(b)?.type === "tool_result")) return null;
    const first = content.find((b) => obj(b)?.type === "text");
    text = str(obj(first)?.text);
  }
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.startsWith("<")) return null;
  return clip(clean, MAX_PROMPT);
}

function toTime(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Accumulates what a Session needs from transcript lines, in file order. */
class SessionBuilder {
  cwd: string | null = null;
  private branch: string | null = null;
  private startedAt: number | null = null;
  private lastActiveAt: number | null = null;
  private firstPrompt: string | null = null;
  private prompts = 0;
  private assistantTurns = 0;
  private aiTitle: string | null = null;
  private agentName: string | null = null;
  private customTitle: string | null = null;
  private summary: string | null = null;
  private model: string | null = null;
  private entrypoint: string | null = null;
  private continuedIn: string | null = null;
  private readonly prLinks = new Set<string>();

  readonly visit = (l: JsonObject): void => {
    this.cwd ??= str(l.cwd);
    this.entrypoint ??= str(l.entrypoint);
    const b = str(l.gitBranch);
    if (b) this.branch = b;
    const t = toTime(l.timestamp);
    if (t !== null) {
      this.startedAt ??= t;
      this.lastActiveAt = Math.max(this.lastActiveAt ?? t, t);
    }
    switch (l.type) {
      case "user": {
        const p = promptText(l);
        if (p) {
          this.prompts++;
          this.firstPrompt ??= p;
        }
        break;
      }
      case "assistant": {
        this.assistantTurns++;
        const m = str(obj(l.message)?.model);
        if (m && !m.startsWith("<")) this.model = m;
        break;
      }
      case "ai-title":
        this.aiTitle = str(l.aiTitle) ?? this.aiTitle;
        break;
      case "agent-name":
        this.agentName = str(l.agentName) ?? this.agentName;
        break;
      case "custom-title":
        this.customTitle = str(l.customTitle) ?? this.customTitle;
        break;
      case "summary":
        this.summary = str(l.summary) ?? this.summary;
        break;
      case "pr-link": {
        const u = str(l.prUrl);
        if (u) this.prLinks.add(u);
        break;
      }
      case "continued-in": {
        const n = l.continuedInSessionId;
        if (isSessionId(n)) this.continuedIn = n;
        break;
      }
    }
  };

  get empty(): boolean {
    return this.prompts === 0 && this.assistantTurns === 0;
  }

  build(
    id: string,
    file: string,
    meta: { mtimeMs: number; size: number; estimated: boolean },
  ): Session {
    const where = this.cwd ?? "";
    const title = clip(
      (this.customTitle ?? this.agentName ?? this.aiTitle ?? this.summary ?? this.firstPrompt ?? "")
        .replace(/\s+/g, " ")
        .trim(),
      MAX_TITLE,
    );
    return {
      id,
      file,
      cwd: where,
      project: projectName(where),
      title: title || "Untitled chat",
      firstPrompt: this.firstPrompt ?? "",
      branch: this.branch === "HEAD" ? null : this.branch,
      startedAt: this.startedAt ?? meta.mtimeMs,
      lastActiveAt: this.lastActiveAt ?? meta.mtimeMs,
      prompts: this.prompts,
      estimated: meta.estimated,
      model: this.model,
      entrypoint: this.entrypoint,
      prLinks: [...this.prLinks],
      continuedIn: this.continuedIn,
      sizeBytes: meta.size,
    };
  }
}

/** Builds a Session from the head and tail of a transcript. Null when it holds no real conversation. */
export function parseSession(id: string, file: string, ht: HeadTail): Session | null {
  const b = new SessionBuilder();
  forEachJsonLine(ht.head, b.visit);
  forEachJsonLine(ht.tail, b.visit);
  if (b.empty) return null;
  return b.build(id, file, { mtimeMs: ht.mtimeMs, size: ht.size, estimated: !ht.whole });
}

/**
 * Reads a whole transcript line by line. Used only when the head and tail
 * windows fall inside huge lines (e.g. pasted screenshots), so the fast path
 * could not see the conversation.
 */
async function scanSession(id: string, file: string, ht: HeadTail): Promise<Session | null> {
  const b = new SessionBuilder();
  await streamJsonLines(file, b.visit);
  if (b.empty) return null;
  return b.build(id, file, { mtimeMs: ht.mtimeMs, size: ht.size, estimated: false });
}

async function readSession(
  id: string,
  file: string,
): Promise<{ ht: HeadTail; s: Session | null } | null> {
  const ht = await readHeadTail(file);
  if (!ht) return null;
  let s = parseSession(id, file, ht);
  if (!ht.whole && !s?.cwd) s = (await scanSession(id, file, ht)) ?? s;
  return { ht, s };
}

async function transcriptFiles(home: string): Promise<{ id: string; file: string }[]> {
  const root = projectsDir(home);
  const out: { id: string; file: string }[] = [];
  for (const dir of await listDirSafe(root)) {
    if (!dir.isDirectory()) continue;
    const dirPath = join(root, dir.name);
    for (const f of await listDirSafe(dirPath)) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const id = basename(f.name, ".jsonl");
      if (isSessionId(id)) out.push({ id, file: join(dirPath, f.name) });
    }
  }
  return out;
}

/** Every Claude Code chat on this machine, newest first. */
export async function listSessions(
  home: string,
  cache?: MtimeCache<Session | null>,
): Promise<Session[]> {
  const files = await transcriptFiles(home);
  cache?.retain(new Set(files.map((f) => f.file)));
  const parsed = await mapLimit(files, PARALLEL, async ({ id, file }) => {
    const st = await statSafe(file);
    if (!st?.isFile()) return null;
    const hit = cache?.get(file, st.mtimeMs, st.size);
    if (hit !== undefined) return hit;
    const r = await readSession(id, file);
    if (r) cache?.set(file, r.ht.mtimeMs, r.ht.size, r.s);
    return r?.s ?? null;
  });
  return parsed
    .filter((s): s is Session => s !== null)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
