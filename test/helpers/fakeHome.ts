import { randomUUID } from "node:crypto";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Line shapes copied from real Claude Code transcripts (content replaced). */
type Line = Record<string, unknown>;

export const slugFor = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

let clock = Date.parse("2026-09-01T10:00:00.000Z");
const tick = (ms = 1000) => new Date((clock += ms)).toISOString();

export interface Ctx {
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  entrypoint?: string;
}

const base = (c: Ctx) => ({
  cwd: c.cwd,
  sessionId: c.sessionId,
  gitBranch: c.gitBranch ?? "main",
  entrypoint: c.entrypoint ?? "cli",
  userType: "external",
  version: "2.1.285",
  isSidechain: false,
  uuid: randomUUID(),
  timestamp: tick(),
});

export const L = {
  mode: (c: Ctx): Line => ({ type: "mode", mode: "normal", sessionId: c.sessionId }),
  user: (c: Ctx, text: string, at?: string): Line => ({
    ...base(c),
    type: "user",
    ...(at ? { timestamp: at } : {}),
    message: { role: "user", content: text },
  }),
  userBlocks: (c: Ctx, text: string): Line => ({
    ...base(c),
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ],
    },
  }),
  meta: (c: Ctx, text: string): Line => ({
    ...base(c),
    type: "user",
    isMeta: true,
    message: { role: "user", content: text },
  }),
  toolResult: (c: Ctx): Line => ({
    ...base(c),
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
    },
  }),
  assistant: (c: Ctx, model = "claude-opus-5-5", at?: string): Line => ({
    ...base(c),
    type: "assistant",
    ...(at ? { timestamp: at } : {}),
    requestId: `req_${randomUUID()}`,
    message: {
      id: `msg_${randomUUID()}`,
      model,
      role: "assistant",
      type: "message",
      content: [{ type: "text", text: "Done." }],
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
        output_tokens: 50,
        cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 0 },
      },
    },
  }),
  aiTitle: (c: Ctx, aiTitle: string): Line => ({
    type: "ai-title",
    aiTitle,
    sessionId: c.sessionId,
  }),
  agentName: (c: Ctx, agentName: string): Line => ({
    type: "agent-name",
    agentName,
    sessionId: c.sessionId,
  }),
  customTitle: (c: Ctx, customTitle: string): Line => ({
    type: "custom-title",
    customTitle,
    sessionId: c.sessionId,
  }),
  prLink: (c: Ctx, prUrl: string): Line => ({
    type: "pr-link",
    sessionId: c.sessionId,
    prNumber: 1,
    prUrl,
    prRepository: "acme/shop",
    timestamp: tick(),
  }),
  continuedIn: (c: Ctx, id: string): Line => ({
    type: "continued-in",
    timestamp: tick(),
    sessionId: c.sessionId,
    continuedInSessionId: id,
  }),
};

export interface WrittenSession {
  id: string;
  file: string;
  ctx: Ctx;
}

/** Writes `projects/<slug>/<id>.jsonl` into a fake Claude home. */
export function writeSession(
  home: string,
  cwd: string,
  build: (c: Ctx) => (Line | string)[],
  opts: { id?: string; gitBranch?: string; mtime?: Date; entrypoint?: string } = {},
): WrittenSession {
  const id = opts.id ?? randomUUID();
  const ctx: Ctx = { sessionId: id, cwd, gitBranch: opts.gitBranch, entrypoint: opts.entrypoint };
  const dir = join(home, "projects", slugFor(cwd));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  const body = build(ctx)
    .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
    .join("\n");
  writeFileSync(file, `${body}\n`);
  if (opts.mtime) utimesSync(file, opts.mtime, opts.mtime);
  return { id, file, ctx };
}
