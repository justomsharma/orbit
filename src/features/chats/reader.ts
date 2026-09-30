import { basename, join } from "node:path";
import type { MtimeCache } from "../../core/cache";
import { mapLimit } from "../../core/concurrency";
import { type HeadTail, listDirSafe, readHeadTail, statSafe } from "../../core/fsSafe";
import { forEachJsonLine, type JsonObject, obj, str } from "../../core/jsonl";
import { projectName, projectsDir } from "../../core/paths";
import { isSessionId } from "../../core/uuid";
import type { Session } from "./types";

const MAX_PROMPT = 300;
const PARALLEL = 32;

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
  return clean.length > MAX_PROMPT ? `${clean.slice(0, MAX_PROMPT - 1)}…` : clean;
}

function toTime(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Builds a Session from the head and tail of a transcript. Null when it holds no real conversation. */
export function parseSession(id: string, file: string, ht: HeadTail): Session | null {
  let cwd: string | null = null;
  let branch: string | null = null;
  let startedAt: number | null = null;
  let lastActiveAt: number | null = null;
  let firstPrompt: string | null = null;
  let prompts = 0;
  let assistantTurns = 0;
  let aiTitle: string | null = null;
  let agentName: string | null = null;
  let customTitle: string | null = null;
  let model: string | null = null;
  let entrypoint: string | null = null;
  let continuedIn: string | null = null;
  const prLinks = new Set<string>();

  const visit = (l: JsonObject) => {
    cwd ??= str(l.cwd);
    entrypoint ??= str(l.entrypoint);
    const b = str(l.gitBranch);
    if (b) branch = b;
    const t = toTime(l.timestamp);
    if (t !== null) {
      startedAt ??= t;
      lastActiveAt = Math.max(lastActiveAt ?? t, t);
    }
    switch (l.type) {
      case "user": {
        const p = promptText(l);
        if (p) {
          prompts++;
          firstPrompt ??= p;
        }
        break;
      }
      case "assistant": {
        assistantTurns++;
        const m = str(obj(l.message)?.model);
        if (m && !m.startsWith("<")) model = m;
        break;
      }
      case "ai-title":
        aiTitle = str(l.aiTitle) ?? aiTitle;
        break;
      case "agent-name":
        agentName = str(l.agentName) ?? agentName;
        break;
      case "custom-title":
        customTitle = str(l.customTitle) ?? customTitle;
        break;
      case "pr-link": {
        const u = str(l.prUrl);
        if (u) prLinks.add(u);
        break;
      }
      case "continued-in": {
        const n = l.continuedInSessionId;
        if (isSessionId(n)) continuedIn = n;
        break;
      }
    }
  };

  forEachJsonLine(ht.head, visit);
  forEachJsonLine(ht.tail, visit);

  if (prompts === 0 && assistantTurns === 0) return null;
  const where = cwd ?? "";
  const title = (customTitle ?? agentName ?? aiTitle ?? firstPrompt ?? "Untitled chat").trim();
  return {
    id,
    file,
    cwd: where,
    project: projectName(where),
    title: title || "Untitled chat",
    firstPrompt: firstPrompt ?? "",
    branch: branch === "HEAD" ? null : branch,
    startedAt: startedAt ?? ht.mtimeMs,
    lastActiveAt: lastActiveAt ?? ht.mtimeMs,
    prompts,
    estimated: !ht.whole,
    model,
    entrypoint,
    prLinks: [...prLinks],
    continuedIn,
    sizeBytes: ht.size,
  };
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
  const parsed = await mapLimit(files, PARALLEL, async ({ id, file }) => {
    const st = await statSafe(file);
    if (!st?.isFile()) return null;
    const hit = cache?.get(file, st.mtimeMs, st.size);
    if (hit !== undefined) return hit;
    const ht = await readHeadTail(file);
    const s = ht ? parseSession(id, file, ht) : null;
    if (ht) cache?.set(file, ht.mtimeMs, ht.size, s);
    return s;
  });
  return parsed
    .filter((s): s is Session => s !== null)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
