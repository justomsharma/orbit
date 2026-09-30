import { applyTextEdit, type ConfirmHost } from "../core/applyEdit";
import { MiB, readTextSafe } from "../core/fsSafe";
import { samePath } from "../core/paths";
import type { SafeWriter } from "../core/safeWriter";
import { searchMessages } from "../features/chats/search";
import { transcriptMarkdown } from "../features/chats/transcript";
import type { Session } from "../features/chats/types";
import { expandPrompt, type PromptLibrary } from "../features/prompts/library";
import { readTimeline, readVersion } from "../features/timeline/reader";
import type { ChangedFile, FileVersion } from "../features/timeline/types";
import { type ChangedFileView, type HostMsg, parseViewMsg, type ViewMsg } from "../shared/protocol";

export interface ChatsHandlerDeps {
  home: string;
  getSession(id: string): Session | undefined;
  /** Every chat, most recent first (the order search results come in). */
  sessions(): Pick<Session, "id" | "file">[];
  prompts: Pick<PromptLibrary, "get" | "update">;
  writer: SafeWriter;
  confirm: ConfirmHost;
  /** Opens Claude's chat, with `prompt` typed in (not sent). */
  newChat(prompt?: string): Promise<void>;
  copy(text: string): Promise<void>;
  info(message: string): void;
  /** VS Code's diff: `left` is text, `right` a file on disk (null shows it empty). */
  showDiff(left: string, right: string | null, title: string, name: string): Promise<void>;
  /** A read-only Markdown preview. */
  showMarkdown(text: string, title: string): Promise<void>;
  /** Save dialog for a Markdown file. */
  saveMarkdown(text: string, suggestedName: string): Promise<void>;
  post(m: HostMsg): void;
}

type ChatsMsg = Extract<ViewMsg, { type: `chat:${string}` | `prompts:${string}` | "search" }>;

/** Search shows at most this many chats. */
const MAX_HITS = 200;

/** Links longer than this may not open; the prompt is copied instead. */
const MAX_PROMPT_IN_LINK = 8000;

const searches = new WeakMap<ChatsHandlerDeps, AbortController>();

const when = (at: number) => (at ? new Date(at).toLocaleString() : "an unknown time");

function toView(f: ChangedFile): ChangedFileView {
  return {
    ...f,
    versions: f.versions.map(({ version, at, available }) => ({ version, at, available })),
  };
}

/** A file name for an exported chat: `Fix the parser` → `fix-the-parser.md`. */
export function exportName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || "chat"}.md`;
}

/** Handles one Chats-tab message. Returns false for messages that belong elsewhere. */
export async function handleChats(raw: unknown, d: ChatsHandlerDeps): Promise<boolean> {
  const m = parseViewMsg(raw);
  if (!m || !(m.type.startsWith("chat:") || m.type.startsWith("prompts:") || m.type === "search"))
    return false;
  const msg = m as ChatsMsg;
  const warn = (text: string) => d.confirm.warn(text);

  const session = (id: string) => {
    const s = d.getSession(id);
    if (!s) warn("This chat is no longer on disk.");
    return s;
  };

  const timeline = (s: Session) =>
    readTimeline({ home: d.home, sessionId: s.id, transcript: s.file, cwd: s.cwd });

  /** Only a file and version from this chat's own timeline — never a path the view made up. */
  const checkpoint = async (
    id: string,
    path: string,
    version: number,
  ): Promise<{ file: ChangedFile; v: FileVersion } | null> => {
    const s = session(id);
    if (!s) return null;
    const file = (await timeline(s)).find((f) => samePath(f.path, path));
    const v = file?.versions.find((x) => x.version === version);
    return file && v ? { file, v } : null;
  };

  switch (msg.type) {
    case "chat:details": {
      const s = session(msg.id);
      if (s) d.post({ type: "chat:details", id: s.id, files: (await timeline(s)).map(toView) });
      return true;
    }

    case "chat:diff":
    case "chat:restore": {
      const c = await checkpoint(msg.id, msg.path, msg.version);
      if (!c) return true;
      const { file, v } = c;
      if (!v.blob) {
        warn(
          `Claude created this file in this chat, so there's no earlier version. Orbit never deletes files.`,
        );
        return true;
      }
      if (!v.available) {
        warn(`Claude no longer has this checkpoint of ${file.name}.`);
        return true;
      }
      const content = await readVersion(v);
      if (!content) {
        warn(`Orbit couldn't read this checkpoint of ${file.name} (it may be too large).`);
        return true;
      }
      if ("binary" in content) {
        warn(`This checkpoint of ${file.name} isn't text, so Orbit can't show or restore it.`);
        return true;
      }
      if (msg.type === "chat:diff") {
        await d.showDiff(
          content.text,
          file.exists ? file.path : null,
          `${file.name}: before Claude's edit (${when(v.at)}) ↔ now`,
          file.name,
        );
        return true;
      }
      if (file.exists && (await readTextSafe(file.path, 5 * MiB)) === content.text) {
        d.info(`${file.name} is already the same as it was before that edit.`);
        return true;
      }
      const restored = await applyTextEdit(d.writer, d.confirm, {
        file: file.path,
        transform: () => content.text,
        summary: file.exists
          ? `Put ${file.name} back to how it was before Claude's edit at ${when(v.at)}? Orbit backs up the current version, and you can undo this.`
          : `Bring back ${file.name} as it was before Claude's edit at ${when(v.at)}? Undo removes it again.`,
        label: `Restored ${file.name}`,
      });
      // The panel shows whether each file exists, so it has to catch up.
      const s = restored ? d.getSession(msg.id) : undefined;
      if (s) d.post({ type: "chat:details", id: s.id, files: (await timeline(s)).map(toView) });
      return true;
    }

    case "chat:transcript":
    case "chat:export": {
      const s = session(msg.id);
      if (!s) return true;
      const md = await transcriptMarkdown(s.file, { title: s.title });
      if (msg.type === "chat:transcript") await d.showMarkdown(md, s.title);
      else await d.saveMarkdown(md, exportName(s.title));
      return true;
    }

    case "prompts:list":
      d.post({ type: "prompts", items: await d.prompts.update() });
      return true;

    case "prompts:copy":
    case "prompts:use": {
      let entry = await d.prompts.get(msg.id);
      if (!entry) {
        await d.prompts.update();
        entry = await d.prompts.get(msg.id);
      }
      if (!entry) {
        warn("That prompt is no longer in Claude's history.");
        return true;
      }
      const { text, missing } = await expandPrompt(d.home, entry.text, entry.pasted);
      const gone = missing
        ? ` ${missing} pasted part${missing === 1 ? " is" : "s are"} no longer saved by Claude, so ${missing === 1 ? "it stays" : "they stay"} as a placeholder.`
        : "";
      if (msg.type === "prompts:copy") {
        await d.copy(text);
        d.info(`Prompt copied.${gone}`);
      } else if (encodeURIComponent(text).length > MAX_PROMPT_IN_LINK) {
        await d.newChat();
        await d.copy(text);
        d.info(`This prompt is long, so it's copied: paste it into Claude.${gone}`);
      } else {
        await d.newChat(text);
        if (gone) d.info(gone.trim());
      }
      return true;
    }

    case "search": {
      searches.get(d)?.abort();
      const ac = new AbortController();
      searches.set(d, ac);
      const wanted = msg.ids ? new Set(msg.ids) : null;
      const files = wanted ? d.sessions().filter((s) => wanted.has(s.id)) : d.sessions();
      let searched = 0;
      let last = Date.now();
      const hits = await searchMessages(files, msg.query, {
        signal: ac.signal,
        maxHits: MAX_HITS,
        onProgress: (done, total) => {
          searched = done;
          // A few updates a second is plenty for "Searched 45 of 117 chats".
          if (ac.signal.aborted || Date.now() - last < 250) return;
          last = Date.now();
          d.post({ type: "search", req: msg.req, hits: [], done: false, searched: done, total });
        },
      });
      // A newer search replaced this one: its results would be stale.
      if (!ac.signal.aborted)
        d.post({
          type: "search",
          req: msg.req,
          hits,
          done: true,
          searched,
          total: files.length,
          capped: hits.length >= MAX_HITS,
        });
      return true;
    }
  }
  return true;
}
