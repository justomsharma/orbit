import { obj, str } from "../../core/jsonl";
import { isSessionId } from "../../core/uuid";
import { userParts } from "./messages";

/** What an imported transcript holds, after checking it's really one Claude Code chat. */
export interface TranscriptCheck {
  sessionId: string;
  cwd: string | null;
  entries: number;
  userMessages: number;
}

/** Checks a `.jsonl` transcript before importing it; throws with a plain reason when it isn't one. */
export function checkTranscript(text: string): TranscriptCheck {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("The file is empty.");
  const ids = new Set<string>();
  let cwd: string | null = null;
  let users = 0;
  for (const [i, line] of lines.entries()) {
    let o: Record<string, unknown> | null;
    try {
      o = obj(JSON.parse(line));
    } catch {
      throw new Error(`Line ${i + 1} isn't valid JSON, so this isn't a Claude Code chat.`);
    }
    if (!o) throw new Error(`Line ${i + 1} isn't a JSON object.`);
    const id = o.sessionId;
    if (isSessionId(id)) ids.add(id);
    cwd ??= str(o.cwd);
    if (userParts(o).length) users++;
  }
  if (!ids.size) throw new Error("No chat id in the file, so this isn't a Claude Code chat.");
  if (ids.size > 1) throw new Error("The file mixes more than one chat.");
  if (!users) throw new Error("The chat has no messages from you.");
  return { sessionId: [...ids][0]!, cwd, entries: lines.length, userMessages: users };
}

/**
 * The transcript with every line's chat id replaced (parsed and re-written per
 * line, never a text search-and-replace), so it imports as a new chat and never
 * overwrites the original. Optionally points it at a new folder.
 */
export function rewriteTranscript(text: string, newId: string, cwd?: string): string {
  if (!isSessionId(newId)) throw new Error("Not a chat id");
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const o = obj(JSON.parse(line));
    if (!o) continue;
    if ("sessionId" in o) o.sessionId = newId;
    if (cwd && typeof o.cwd === "string") o.cwd = cwd;
    out.push(JSON.stringify(o));
  }
  return `${out.join("\n")}\n`;
}

export interface ManifestEntry {
  id: string;
  file: string;
  name: string;
  project: string;
  projectPath: string;
  branch: string | null;
  startTime: number;
  endTime: number;
  messageCount: number;
}

/** The manifest of an exported zip (the same shape Claude Code Manager uses, so both import it). */
export function manifest(entries: ManifestEntry[], now = new Date()): string {
  return JSON.stringify(
    { version: 1, exportedAt: now.toISOString(), count: entries.length, sessions: entries },
    null,
    2,
  );
}

/** Reads a manifest; unknown or broken entries are left out. */
export function readManifest(text: string): ManifestEntry[] {
  try {
    const m = obj(JSON.parse(text));
    if (!m || !Array.isArray(m.sessions)) return [];
    return m.sessions.flatMap((raw) => {
      const e = obj(raw);
      const id = e?.id;
      if (!e || !isSessionId(id)) return [];
      return [
        {
          id,
          file: str(e.file) ?? `sessions/${id}.jsonl`,
          name: str(e.name) ?? "",
          project: str(e.project) ?? "",
          projectPath: str(e.projectPath) ?? "",
          branch: str(e.branch),
          startTime: typeof e.startTime === "number" ? e.startTime : 0,
          endTime: typeof e.endTime === "number" ? e.endTime : 0,
          messageCount: typeof e.messageCount === "number" ? e.messageCount : 0,
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Claude Code's folder name for a project under ~/.claude/projects: every character
 * that isn't a letter or digit becomes "-"; very long paths are shortened with a hash.
 */
export function projectFolderName(path: string): string {
  const slug = path.replace(/[^a-zA-Z0-9]/g, "-");
  if (slug.length <= 200) return slug;
  let h = 0;
  for (const c of path) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return `${slug.slice(0, 200)}-${Math.abs(h).toString(36)}`;
}
