import { describe, expect, it } from "vitest";
import { unzip, zip } from "../../core/zip";
import type { ConversationPage } from "../../features/chats/conversation";
import { manifest } from "../../features/chats/portable";
import type { Session } from "../../features/chats/types";
import type { HostMsg } from "../../shared/protocol";
import { handleSessions, type SessionsDeps } from "../sessionsHandler";

const A = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const B = "11111111-2222-4333-8444-555555555555";
const C = "22222222-3333-4444-8555-666666666666";
const NEW = "33333333-4444-4555-8666-777777777777";
const chat = (id: string, over: Partial<Session> = {}): Session =>
  ({
    id,
    file: `/h/projects/x/${id}.jsonl`,
    cwd: "/code/shop",
    project: "shop",
    title: `Chat ${id.slice(0, 4)}`,
    firstPrompt: "",
    branch: "main",
    startedAt: 1,
    lastActiveAt: 2,
    prompts: 3,
    estimated: false,
    model: null,
    entrypoint: "cli",
    prLinks: [],
    continuedIn: null,
    sizeBytes: 1,
    ...over,
  }) as Session;
const transcript = (id: string) =>
  `${JSON.stringify({ type: "user", sessionId: id, cwd: "/far/away", message: { role: "user", content: "hi" } })}\n`;

function setup(
  o: {
    sessions?: Session[];
    live?: string[];
    answer?: boolean;
    files?: Record<string, Buffer>;
    picks?: string[];
    project?: string | null;
    exists?: (p: string) => boolean;
    restore?: number;
  } = {},
) {
  const log: string[] = [];
  const posts: HostMsg[] = [];
  const created: Record<string, string> = {};
  let saved: Buffer | null = null;
  const sessions = o.sessions ?? [chat(A), chat(B), chat(C)];
  const d: SessionsDeps = {
    getSession: (id) => sessions.find((s) => s.id === id) ?? (id === NEW ? chat(NEW) : undefined),
    sessions: () => sessions,
    live: () =>
      (o.live ?? []).map((id) => ({
        sessionId: id,
        pid: 1,
        status: "busy" as const,
        name: null,
        updatedAt: 1,
      })),
    here: () => sessions.map((s) => s.id),
    conversations: {
      get: async () => ({
        turns: [
          { role: "you", at: 1, text: "first", thinking: null, tools: [], usage: null },
          { role: "claude", at: 2, text: "second", thinking: null, tools: [], usage: null },
        ],
        stats: {
          messages: 2,
          tools: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          durationMs: 1,
        },
      }),
    },
    state: {
      mark: async (set, ids, on) => void log.push(`mark ${set} ${ids.join(",")} ${on}`),
      marked: () => [],
      setPin: async (id, on) => void log.push(`pin ${id} ${on}`),
    },
    post: (m) => void posts.push(m),
    copy: async (t) => void log.push(`copy ${t}`),
    info: (t) => void log.push(`info ${t}`),
    warn: (t) => void log.push(`warn ${t}`),
    confirm: async (msg) => {
      log.push(`confirm ${msg}`);
      return o.answer ?? true;
    },
    saveFile: async (name, _f, bytes) => {
      saved = bytes;
      log.push(`save ${name}`);
      return `/down/${name}`;
    },
    pickFiles: async () => o.picks ?? [],
    readFile: async (p) =>
      o.files?.[p] ?? (p.endsWith(".jsonl") ? Buffer.from(transcript(A)) : null),
    pickProject: async () => (o.project === undefined ? "/code/shop" : o.project),
    pathExists: async (p) => (o.exists ? o.exists(p) : true),
    projectDir: (cwd) => `/h/projects/${cwd.replace(/[^a-z]/gi, "-")}`,
    createFile: async (p, text) => {
      created[p] = text;
      return true;
    },
    newId: () => NEW,
    resume: async (s) => void log.push(`resume ${s.id}`),
    showTerminal: (id) => {
      log.push(`show ${id}`);
      return true;
    },
    startTemp: async () => void log.push("temp"),
    openFolder: async (p, w) => void log.push(`folder ${p} ${w}`),
    newChat: async (t) => void log.push(`chat ${t}`),
    restoreCount: () => o.restore ?? 4,
    refresh: async () => void log.push("refresh"),
  };
  return { log, posts, created, saved: () => saved, handle: (m: object) => handleSessions(m, d) };
}

describe("handleSessions", () => {
  it("leaves messages it doesn't own alone", async () => {
    expect(await setup().handle({ type: "newChat" })).toBe(false);
  });

  it("answers a page of a conversation, newest first", async () => {
    const { handle, posts } = setup();
    await handle({
      type: "chat:conversation",
      id: A,
      order: "latest",
      query: "",
      limit: 50,
      req: "r1",
    });
    const m = posts[0] as { type: string; req: string; page: ConversationPage };
    expect(m.req).toBe("r1");
    expect(m.page.turns.map((t) => t.text)).toEqual(["second", "first"]);
  });

  it("archives, hides and pins many chats at once", async () => {
    const { handle, log } = setup();
    await handle({ type: "chat:mark", ids: [A, B], set: "hidden", on: true });
    await handle({ type: "chat:pinMany", ids: [A, B], on: true });
    expect(log).toEqual([
      `mark hidden ${A},${B} true`,
      "refresh",
      expect.stringMatching(/^info 2 chats hidden from the list.*Filter → Hidden/),
      `pin ${A} true`,
      `pin ${B} true`,
      "refresh",
    ]);
  });

  it("saves one chat as .jsonl, and several as a zip with a manifest", async () => {
    const one = setup();
    await one.handle({ type: "chat:save", ids: [A] });
    expect(one.log[0]).toMatch(/^save chat-0b95\.jsonl$/);
    const many = setup();
    await many.handle({ type: "chat:save", ids: [A, B] });
    expect(many.log[0]).toMatch(/^save claude-chats-\d{4}-\d{2}-\d{2}\.zip$/);
    const names = unzip(many.saved()!).map((e) => e.name);
    expect(names).toEqual(["manifest.json", `sessions/${A}.jsonl`, `sessions/${B}.jsonl`]);
  });

  it("imports a chat under a new id into the folder you pick, then continues it", async () => {
    const { handle, log, created } = setup({ picks: ["/down/x.jsonl"] });
    await handle({ type: "chats:import", many: false });
    expect(log[0]).toMatch(/^confirm Import this chat into shop\?/);
    const file = Object.keys(created)[0]!;
    expect(file).toBe(`/h/projects/-code-shop/${NEW}.jsonl`);
    const line = JSON.parse(created[file]!.trim());
    expect(line.sessionId).toBe(NEW);
    expect(line.cwd).toBe("/code/shop");
    expect(log).toContain(`resume ${NEW}`);
  });

  it("refuses a file that isn't a chat", async () => {
    const { handle, log, created } = setup({
      picks: ["/down/x.jsonl"],
      files: { "/down/x.jsonl": Buffer.from("nope") },
    });
    await handle({ type: "chats:import", many: false });
    expect(log[0]).toMatch(/^warn Can't import this file/);
    expect(created).toEqual({});
  });

  it("imports many from a zip, each into its own folder when it exists here", async () => {
    const z = zip([
      {
        name: "manifest.json",
        data: Buffer.from(
          manifest([
            {
              id: A,
              file: `sessions/${A}.jsonl`,
              name: "a",
              project: "shop",
              projectPath: "/code/shop",
              branch: null,
              startTime: 0,
              endTime: 0,
              messageCount: 1,
            },
          ]),
        ),
      },
      { name: `sessions/${A}.jsonl`, data: Buffer.from(transcript(A)) },
    ]);
    const { handle, log, created } = setup({
      picks: ["/down/all.zip"],
      files: { "/down/all.zip": z },
    });
    await handle({ type: "chats:import", many: true });
    expect(log[0]).toMatch(/^confirm Import 1 chat\?/);
    expect(Object.keys(created)).toEqual([`/h/projects/-code-shop/${NEW}.jsonl`]);
    expect(log.at(-1)).toBe("info Imported 1 chat.");
  });

  it("restores the most recent chats as terminals, oldest first, showing the running ones", async () => {
    const { handle, log } = setup({ live: [A], restore: 3 });
    await handle({ type: "chats:restore" });
    expect(log).toEqual([
      `show ${A}`,
      `resume ${C}`,
      `resume ${B}`,
      expect.stringMatching(/already running/),
    ]);
  });

  it("asks before opening more than four terminals", async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      chat(`4${i}444444-4444-4444-8444-444444444444`),
    );
    const { handle, log } = setup({ sessions: many, restore: 6, answer: false });
    await handle({ type: "chats:restore" });
    expect(log).toEqual(["confirm Restore 6 chats?"]);
  });

  it("copies an id, opens a chat's folder and asks again", async () => {
    const { handle, log } = setup();
    await handle({ type: "chat:copyId", id: A });
    await handle({ type: "chat:openFolder", id: A });
    await handle({ type: "chat:askAgain", id: A, text: "Do it again" });
    expect(log).toEqual([
      `copy ${A}`,
      `info Copied the chat id ${A}.`,
      "folder /code/shop true",
      "chat Do it again",
    ]);
  });
});
