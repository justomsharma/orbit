import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { L, writeBlob, writeSession } from "../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../test/helpers/tmp";
import type { ConfirmHost } from "../../core/applyEdit";
import { SafeWriter } from "../../core/safeWriter";
import type { Session } from "../../features/chats/types";
import { PromptLibrary } from "../../features/prompts/library";
import type { HostMsg } from "../../shared/protocol";
import { type ChatsHandlerDeps, handleChats } from "../chatsHandler";

const tmp = useTmpDir();
const V1 = "0123456789abcdef@v1";
const V2 = "0123456789abcdef@v2";

function setup(answer: "apply" | "cancel" = "apply") {
  const root = tmp();
  const home = join(root, ".claude");
  const cwd = join(root, "shop");
  mkdirSync(join(cwd, "src"), { recursive: true });
  const id = randomUUID();
  const a = join(cwd, "src", "a.ts");
  const made = join(cwd, "src", "new.ts");
  const written = writeSession(
    home,
    cwd,
    (c) => [
      L.user(c, "fix the parser please"),
      L.assistant(c, "claude-opus-5-5", undefined, {
        blocks: [{ type: "text", text: "Fixed the parser." }],
      }),
      L.fileDelta(c, a, { backupFileName: V1, version: 1, realParentDir: join(cwd, "src") }),
      L.fileDelta(c, a, { backupFileName: V2, version: 2, realParentDir: join(cwd, "src") }),
      L.fileDelta(c, made, { backupFileName: null, version: 1, realParentDir: join(cwd, "src") }),
    ],
    { id },
  );
  writeBlob(home, id, V1, "original\n");
  writeBlob(home, id, V2, "middle\n");
  writeFileSync(a, "now\n");
  writeFileSync(made, "brand new\n");
  const session: Session = {
    id,
    file: written.file,
    cwd,
    project: "shop",
    title: "Fix the parser",
    firstPrompt: "fix the parser please",
    branch: null,
    startedAt: 1,
    lastActiveAt: 2,
    prompts: 1,
    estimated: false,
    model: null,
    entrypoint: "cli",
    prLinks: [],
    continuedIn: null,
    sizeBytes: 1,
  };
  writeFileSync(
    join(home, "history.jsonl"),
    `${JSON.stringify({
      display: "review [Pasted text #1 +1 lines]",
      pastedContents: { "1": { id: 1, type: "text", content: "PASTED" } },
      timestamp: 5,
      project: cwd,
      sessionId: id,
    })}\n`,
  );
  const log: string[] = [];
  const posted: HostMsg[] = [];
  const confirm: ConfirmHost = {
    confirm: async (s) => {
      log.push(`confirm ${s}`);
      return answer;
    },
    showDiff: async () => {},
    done: async (l) => {
      log.push(`done ${l}`);
    },
    warn: (m) => log.push(`warn ${m}`),
  };
  const prompts = new PromptLibrary(home);
  const deps: ChatsHandlerDeps = {
    home,
    getSession: (x) => (x === id ? session : undefined),
    sessions: () => [session],
    prompts,
    writer: new SafeWriter(join(root, "backups")),
    confirm,
    newChat: async (p) => {
      log.push(`chat ${p ?? ""}`);
    },
    copy: async (t) => {
      log.push(`copy ${t}`);
    },
    info: (m) => log.push(`info ${m}`),
    showDiff: async (left, right, title) => {
      log.push(`diff ${left} | ${right ?? "(none)"} | ${title}`);
    },
    showMarkdown: async (text, title) => {
      log.push(`md ${title}\n${text}`);
    },
    saveMarkdown: async (text, name) => {
      log.push(`save ${name}\n${text}`);
    },
    post: (m) => posted.push(m),
  };
  return {
    home,
    cwd,
    id,
    a,
    made,
    deps,
    log,
    posted,
    prompts,
    handle: (m: object) => handleChats(m, deps),
  };
}

describe("handleChats: files Claude changed", () => {
  it("lists the changed files without sending blob paths to the view", async () => {
    const { handle, posted, id, a, home } = setup();
    expect(await handle({ type: "chat:details", id })).toBe(true);
    const m = posted[0] as Extract<HostMsg, { type: "chat:details" }>;
    expect(m.id).toBe(id);
    const file = m.files.find((f) => f.path === a)!;
    expect(file.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(m.files.find((f) => f.name === "new.ts")?.createdByClaude).toBe(true);
    expect(JSON.stringify(m)).not.toContain(join(home, "file-history"));
  });

  it("compares a version with the file as it is now", async () => {
    const { handle, log, id, a } = setup();
    await handle({ type: "chat:diff", id, path: a, version: 2 });
    expect(log[0]).toMatch(/^diff middle\n \| .*a\.ts \| a\.ts: before Claude's edit/);
  });

  it("restores a version after asking, with undo", async () => {
    const { handle, log, id, a } = setup();
    await handle({ type: "chat:restore", id, path: a, version: 1 });
    expect(log[0]).toMatch(/^confirm Put a\.ts back to how it was before Claude's edit/);
    expect(readFileSync(a, "utf8")).toBe("original\n");
    expect(log.some((l) => l.startsWith("done"))).toBe(true);
  });

  it("writes nothing when the restore is cancelled", async () => {
    const { handle, id, a } = setup("cancel");
    await handle({ type: "chat:restore", id, path: a, version: 1 });
    expect(readFileSync(a, "utf8")).toBe("now\n");
  });

  it("never deletes a file Claude created", async () => {
    const { handle, log, id, made } = setup();
    await handle({ type: "chat:restore", id, path: made, version: 1 });
    expect(readFileSync(made, "utf8")).toBe("brand new\n");
    expect(log[0]).toMatch(/^warn .*Claude created this file/);
  });

  it("ignores paths and versions that aren't in this chat's timeline", async () => {
    const { handle, log, id, cwd, a } = setup();
    const other = join(cwd, "secret.txt");
    writeFileSync(other, "keep");
    await handle({ type: "chat:restore", id, path: other, version: 1 });
    await handle({ type: "chat:restore", id, path: a, version: 9 });
    await handle({ type: "chat:diff", id: randomUUID(), path: a, version: 1 });
    expect(readFileSync(other, "utf8")).toBe("keep");
    expect(readFileSync(a, "utf8")).toBe("now\n");
    expect(log.filter((l) => l.startsWith("confirm"))).toEqual([]);
  });

  it("won't restore a binary checkpoint", async () => {
    const { handle, log, id, a, home } = setup();
    writeBlob(home, id, V1, Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    await handle({ type: "chat:restore", id, path: a, version: 1 });
    expect(readFileSync(a, "utf8")).toBe("now\n");
    expect(log[0]).toMatch(/^warn .*isn't text/);
  });
});

describe("handleChats: transcript", () => {
  it("opens a readable transcript", async () => {
    const { handle, log, id } = setup();
    await handle({ type: "chat:transcript", id });
    expect(log[0]).toMatch(/^md Fix the parser\n# Fix the parser/);
    expect(log[0]).toContain("fix the parser please");
  });

  it("exports it as Markdown with a safe file name", async () => {
    const { handle, log, id } = setup();
    await handle({ type: "chat:export", id });
    expect(log[0]).toMatch(/^save fix-the-parser\.md\n# Fix the parser/);
  });
});

describe("handleChats: prompts", () => {
  it("sends the prompt library", async () => {
    const { handle, posted } = setup();
    await handle({ type: "prompts:list" });
    const m = posted[0] as Extract<HostMsg, { type: "prompts" }>;
    expect(m.items.map((p) => p.text)).toEqual(["review [Pasted text #1 +1 lines]"]);
  });

  it("copies and reuses a prompt with its pasted text put back", async () => {
    const { handle, log, prompts } = setup();
    const [p] = await prompts.update();
    await handle({ type: "prompts:copy", id: p!.id });
    await handle({ type: "prompts:use", id: p!.id });
    expect(log).toContain("copy review PASTED");
    expect(log).toContain("chat review PASTED");
  });

  it("copies a very long prompt instead of cramming it into a link", async () => {
    const { handle, log, prompts, home, id, cwd } = setup();
    writeFileSync(
      join(home, "history.jsonl"),
      `${JSON.stringify({ display: "x".repeat(20_000), pastedContents: {}, timestamp: 9, project: cwd, sessionId: id })}\n`,
    );
    const [p] = await prompts.update();
    await handle({ type: "prompts:use", id: p!.id });
    expect(log[0]).toBe("chat ");
    expect(log[1]).toMatch(/^copy x{20000}$/);
    expect(log[2]).toMatch(/^info .*paste/i);
  });
});

describe("handleChats: search", () => {
  it("searches messages and replies to the request", async () => {
    const { handle, posted, id } = setup();
    await handle({ type: "search", query: "PARSER", req: "s1" });
    const m = posted.at(-1) as Extract<HostMsg, { type: "search" }>;
    expect(m).toMatchObject({ req: "s1", done: true });
    expect(m.hits.map((h) => h.sessionId)).toEqual([id]);
  });

  it("leaves other messages to other handlers", async () => {
    const { handle } = setup();
    expect(await handle({ type: "refresh" })).toBe(false);
    expect(await handle({ type: "setup:refresh" })).toBe(false);
  });
});
