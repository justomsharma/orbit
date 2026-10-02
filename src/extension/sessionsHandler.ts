import { basename } from "node:path";
import { unzip, zip } from "../core/zip";
import { type ConversationCache, pageOf } from "../features/chats/conversation";
import {
  checkTranscript,
  type ManifestEntry,
  manifest,
  readManifest,
  rewriteTranscript,
} from "../features/chats/portable";
import type { LiveStatus, Session } from "../features/chats/types";
import { type HostMsg, parseViewMsg } from "../shared/protocol";
import type { OrbitState } from "./state";

export interface SessionsDeps {
  getSession(id: string): Session | undefined;
  /** Every chat, most recent first. */
  sessions(): Session[];
  live(): LiveStatus[];
  /** Chats in the open folder. */
  here(): string[];
  conversations: Pick<ConversationCache, "get">;
  state: Pick<OrbitState, "mark" | "marked" | "setPin">;
  post(m: HostMsg): void;
  copy(text: string): Promise<void>;
  info(message: string): void;
  warn(message: string): void;
  /** A modal question with one action; true when chosen. */
  confirm(message: string, detail: string, action: string): Promise<boolean>;
  /** Save dialog; resolves to where it was saved, or null when cancelled. */
  saveFile(name: string, filters: Record<string, string[]>, bytes: Buffer): Promise<string | null>;
  pickFiles(many: boolean, filters: Record<string, string[]>): Promise<string[]>;
  readFile(path: string): Promise<Buffer | null>;
  /** Which folder an imported chat belongs to; null when cancelled. */
  pickProject(title: string): Promise<string | null>;
  pathExists(path: string): Promise<boolean>;
  /** Claude's transcript folder for a project (the one its chats already use, if any). */
  projectDir(cwd: string): string;
  /** Creates a new file (backed by Orbit's undo history). False when it couldn't. */
  createFile(path: string, text: string): Promise<boolean>;
  newId(): string;
  /** `claude --resume` in a terminal. */
  resume(s: Session): Promise<void>;
  /** Shows the terminal a running chat is in; false when Orbit doesn't know it. */
  showTerminal(id: string): boolean;
  /** Starts a temporary chat (hidden when its terminal closes, unless made permanent). */
  startTemp(): Promise<void>;
  openFolder(path: string, newWindow: boolean): Promise<void>;
  newChat(prompt: string): Promise<void>;
  /** Orbit's "Restore recent terminals" count. */
  restoreCount(): number;
  refresh(): Promise<void>;
}

const MAX_IMPORT = 200 * 1024 * 1024;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const day = () => new Date().toISOString().slice(0, 10);

/** A file name from a chat title: `Fix the parser` → `fix-the-parser`. */
const fileStem = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "") || "chat";

/** Chats actions beyond reading: pages of a conversation, lists, export/import, restore. */
export async function handleSessions(raw: unknown, d: SessionsDeps): Promise<boolean> {
  const m = parseViewMsg(raw);
  if (!m) return false;
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const importOne = async (text: string, cwd: string, meta?: string): Promise<string | null> => {
    checkTranscript(text);
    const id = d.newId();
    const file = `${d.projectDir(cwd)}/${id}.jsonl`;
    const ok = await d.createFile(file, rewriteTranscript(text, id, cwd));
    if (!ok) throw new Error(`Couldn't write the imported chat${meta ? ` "${meta}"` : ""}.`);
    return id;
  };

  switch (m.type) {
    case "chat:conversation": {
      const s = d.getSession(m.id);
      const all = s ? await d.conversations.get(s.file) : null;
      if (!all) {
        d.warn("This chat is no longer on disk.");
        return true;
      }
      d.post({
        type: "chat:conversation",
        id: m.id,
        req: m.req,
        page: pageOf(all, { order: m.order, limit: m.limit, query: m.query }),
      });
      return true;
    }

    case "chat:mark":
      await d.state.mark(m.set, m.ids, m.on);
      await d.refresh();
      if (m.on && m.set === "hidden")
        d.info(
          `${m.ids.length === 1 ? "Hidden" : `${m.ids.length} chats hidden`} from the list. Claude's files are untouched: find ${m.ids.length === 1 ? "it" : "them"} under Filter → Hidden to show ${m.ids.length === 1 ? "it" : "them"} again.`,
        );
      return true;

    case "chat:pinMany":
      for (const id of m.ids) await d.state.setPin(id, m.on);
      await d.refresh();
      return true;

    case "chat:copyId":
      await d.copy(m.id);
      d.info(`Copied the chat id ${m.id}.`);
      return true;

    case "chat:openFolder": {
      const s = d.getSession(m.id);
      if (!s?.cwd) return true;
      if (!(await d.pathExists(s.cwd))) {
        d.warn(`The folder for this chat no longer exists: ${s.cwd}`);
        return true;
      }
      await d.openFolder(s.cwd, true);
      return true;
    }

    case "chat:askAgain":
      await d.newChat(m.text);
      return true;

    case "chat:save": {
      const chats = m.ids.map((id) => d.getSession(id)).filter((s): s is Session => !!s);
      if (!chats.length) {
        d.warn("None of these chats are on disk any more.");
        return true;
      }
      if (chats.length === 1) {
        const s = chats[0]!;
        const bytes = await d.readFile(s.file);
        if (!bytes) {
          d.warn("Orbit couldn't read this chat.");
          return true;
        }
        const where = await d.saveFile(
          `${fileStem(s.title)}.jsonl`,
          { "Claude Code chat": ["jsonl"] },
          bytes,
        );
        if (where) d.info(`Saved ${basename(where)}. Import it in Orbit on any computer.`);
        return true;
      }
      const entries: ManifestEntry[] = [];
      const files: { name: string; data: Buffer }[] = [];
      let skipped = 0;
      for (const s of chats) {
        const bytes = await d.readFile(s.file);
        if (!bytes) {
          skipped++;
          continue;
        }
        const file = `sessions/${s.id}.jsonl`;
        files.push({ name: file, data: bytes });
        entries.push({
          id: s.id,
          file,
          name: s.title,
          project: s.project,
          projectPath: s.cwd,
          branch: s.branch,
          startTime: s.startedAt,
          endTime: s.lastActiveAt,
          messageCount: s.prompts,
        });
      }
      if (!files.length) {
        d.warn("Orbit couldn't read any of these chats.");
        return true;
      }
      const archive = zip([
        { name: "manifest.json", data: Buffer.from(manifest(entries)) },
        ...files,
      ]);
      const where = await d.saveFile(
        `claude-chats-${day()}.zip`,
        { "Zip archive": ["zip"] },
        archive,
      );
      if (where)
        d.info(
          `Exported ${plural(files.length, "chat")} to ${basename(where)}${skipped ? ` (${skipped} skipped: not on disk)` : ""}.`,
        );
      return true;
    }

    case "chats:import": {
      const paths = await d.pickFiles(
        m.many,
        m.many ? { Chats: ["jsonl", "zip"] } : { "Claude Code chat": ["jsonl"] },
      );
      if (!paths.length) return true;
      if (!m.many) {
        const bytes = await d.readFile(paths[0]!);
        if (!bytes || bytes.length > MAX_IMPORT) {
          d.warn("Orbit couldn't read that file.");
          return true;
        }
        const text = bytes.toString("utf8");
        let check: ReturnType<typeof checkTranscript>;
        try {
          check = checkTranscript(text);
        } catch (e) {
          d.warn(`Can't import this file: ${(e as Error).message}`);
          return true;
        }
        const cwd = await d.pickProject("Import the chat into which folder?");
        if (!cwd) return true;
        if (!(await d.pathExists(cwd))) {
          d.warn(`That folder doesn't exist: ${cwd}`);
          return true;
        }
        const go = await d.confirm(
          `Import this chat into ${basename(cwd)}?`,
          `${plural(check.userMessages, "message")} from you, ${plural(check.entries, "entry")} in all, into ${cwd}. It's added as a new chat; nothing is overwritten.`,
          "Import & continue",
        );
        if (!go) return true;
        try {
          const id = await importOne(text, cwd);
          await d.refresh();
          const s = id ? d.getSession(id) : undefined;
          if (s) await d.resume(s);
        } catch (e) {
          d.warn((e as Error).message);
        }
        return true;
      }
      // Several files: zips from Orbit or Claude Code Manager, and .jsonl files.
      const items: { text: string; cwd: string | null; label: string }[] = [];
      let bad = 0;
      for (const p of paths) {
        const bytes = await d.readFile(p);
        if (!bytes || bytes.length > MAX_IMPORT) {
          bad++;
          continue;
        }
        if (p.toLowerCase().endsWith(".zip")) {
          try {
            const entries = unzip(bytes);
            const byName = new Map(entries.map((e) => [e.name, e.data]));
            const list = readManifest(byName.get("manifest.json")?.toString("utf8") ?? "");
            for (const e of list) {
              const data = byName.get(e.file);
              if (data)
                items.push({
                  text: data.toString("utf8"),
                  cwd: e.projectPath || null,
                  label: e.name,
                });
              else bad++;
            }
          } catch {
            bad++;
          }
        } else items.push({ text: bytes.toString("utf8"), cwd: null, label: basename(p) });
      }
      const valid = items.filter((i) => {
        try {
          checkTranscript(i.text);
          return true;
        } catch {
          bad++;
          return false;
        }
      });
      if (!valid.length) {
        d.warn("Nothing in those files could be imported.");
        return true;
      }
      const known: boolean[] = [];
      for (const i of valid) known.push(!!i.cwd && (await d.pathExists(i.cwd)));
      let fallback: string | null = null;
      if (known.some((k) => !k)) {
        fallback = await d.pickProject("Import chats whose folder isn't on this computer into…");
        if (!fallback) return true;
      }
      const restored = known.filter(Boolean).length;
      const go = await d.confirm(
        `Import ${plural(valid.length, "chat")}?`,
        [
          restored ? `${restored} into their own folders.` : "",
          valid.length - restored ? `${valid.length - restored} into ${fallback}.` : "",
          bad ? `${bad} skipped (not a Claude Code chat).` : "",
          "Each is added as a new chat. Nothing is overwritten.",
        ]
          .filter(Boolean)
          .join("\n"),
        "Import",
      );
      if (!go) return true;
      let done = 0;
      let failed = 0;
      for (const [n, i] of valid.entries()) {
        try {
          await importOne(i.text, known[n] ? i.cwd! : fallback!, i.label);
          done++;
        } catch {
          failed++;
        }
      }
      await d.refresh();
      d.info(
        `Imported ${plural(done, "chat")}${failed ? ` (${failed} couldn't be written)` : ""}.`,
      );
      return true;
    }

    case "chats:restore": {
      const hidden = new Set([...d.state.marked("hidden"), ...d.state.marked("archived")]);
      const here = new Set(d.here());
      const scope = d
        .sessions()
        .filter((s) => !hidden.has(s.id) && (here.size === 0 || here.has(s.id)));
      const recent = scope.slice(0, d.restoreCount());
      if (!recent.length) {
        d.info("Nothing to restore: no chats here yet.");
        return true;
      }
      const live = new Set(d.live().map((l) => l.sessionId));
      const running = recent.filter((s) => live.has(s.id));
      const toOpen = recent.filter((s) => !live.has(s.id)).reverse();
      for (const s of running) d.showTerminal(s.id);
      if (toOpen.length > 4) {
        const go = await d.confirm(
          `Restore ${toOpen.length} chats?`,
          `This opens ${toOpen.length} terminals in this window.`,
          "Restore",
        );
        if (!go) return true;
      }
      for (const s of toOpen) {
        await d.resume(s);
        await delay(80);
      }
      if (running.length)
        d.info(
          `${plural(running.length, "chat")} ${running.length === 1 ? "was" : "were"} already running, so Orbit showed ${running.length === 1 ? "it" : "them"}.`,
        );
      return true;
    }

    case "chats:newTemp":
      await d.startTemp();
      return true;
  }
  return false;
}
