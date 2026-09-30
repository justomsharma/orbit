import { randomUUID } from "node:crypto";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Line shapes copied from real Claude Code transcripts (content replaced). */
type Line = Record<string, unknown>;

export const slugFor = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

let clock = Date.parse("2026-09-01T10:00:00.000Z");
function tick(ms = 1000): string {
  clock += ms;
  return new Date(clock).toISOString();
}

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

/** Knobs for `L.assistant`; defaults match a typical cached Opus reply. */
export interface AssistantOpts {
  /** Reuse an id to write one message as several lines (one per content block). */
  id?: string;
  text?: string;
  input?: number;
  output?: number;
  read?: number;
  write5m?: number;
  write1h?: number;
  webSearches?: number;
  speed?: "standard" | "fast";
  geo?: string;
  sidechain?: boolean;
  /** Replaces the whole `usage` object (e.g. an older shape without `cache_creation`). */
  usage?: Record<string, unknown>;
  /** Replaces the content blocks (default: one text block from `text`). */
  blocks?: unknown[];
}

/** One tracked file inside a `file-history-*` line. `backupFileName: null` = Claude created it. */
export interface Backup {
  backupFileName: string | null;
  version: number;
  backupTime?: string;
  realParentDir?: string;
}

const backup = (b: Backup) => ({
  backupFileName: b.backupFileName,
  version: b.version,
  backupTime: b.backupTime ?? tick(),
  ...(b.realParentDir !== undefined ? { realParentDir: b.realParentDir } : {}),
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
  assistant: (c: Ctx, model = "claude-opus-5-5", at?: string, o: AssistantOpts = {}): Line => ({
    ...base(c),
    type: "assistant",
    ...(at ? { timestamp: at } : {}),
    ...(o.sidechain ? { isSidechain: true, agentId: "a1b2c3d4" } : {}),
    requestId: `req_${randomUUID()}`,
    message: {
      id: o.id ?? `msg_${randomUUID()}`,
      model,
      role: "assistant",
      type: "message",
      content: o.blocks ?? [{ type: "text", text: o.text ?? "Done." }],
      usage: o.usage ?? {
        input_tokens: o.input ?? 10,
        cache_creation_input_tokens: (o.write5m ?? 0) + (o.write1h ?? 100),
        cache_read_input_tokens: o.read ?? 1000,
        output_tokens: o.output ?? 50,
        server_tool_use: { web_search_requests: o.webSearches ?? 0, web_fetch_requests: 0 },
        service_tier: "standard",
        cache_creation: {
          ephemeral_1h_input_tokens: o.write1h ?? 100,
          ephemeral_5m_input_tokens: o.write5m ?? 0,
        },
        inference_geo: o.geo ?? "not_available",
        iterations: [],
        speed: o.speed ?? "standard",
      },
    },
  }),
  /** An assistant line holding one tool call (Claude writes one line per content block). */
  toolUse: (c: Ctx, name: string, input: Record<string, unknown>, o: AssistantOpts = {}): Line =>
    L.assistant(c, "claude-opus-5-5", undefined, {
      ...o,
      blocks: [{ type: "tool_use", id: `toolu_${randomUUID()}`, name, input }],
    }),
  /** Claude's checkpoint of one file just before it edits it. */
  fileDelta: (c: Ctx, trackingPath: string, b: Backup, messageId: string = randomUUID()): Line => ({
    type: "file-history-delta",
    messageId,
    snapshotMessageId: randomUUID(),
    trackingPath,
    backup: backup(b),
    timestamp: tick(),
    sessionId: c.sessionId,
  }),
  /** A full checkpoint of every tracked file, keyed by tracking path. */
  fileSnapshot: (
    _c: Ctx,
    files: Record<string, Backup>,
    o: { messageId?: string; isSnapshotUpdate?: boolean } = {},
  ): Line => {
    const messageId = o.messageId ?? randomUUID();
    return {
      type: "file-history-snapshot",
      messageId,
      isSnapshotUpdate: o.isSnapshotUpdate ?? false,
      snapshot: {
        messageId,
        timestamp: tick(),
        trackedFileBackups: Object.fromEntries(
          Object.entries(files).map(([k, b]) => [k, backup(b)]),
        ),
      },
    };
  },
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

/** Writes a checkpoint blob to `file-history/<sessionId>/<name>`; returns its path. */
export function writeBlob(
  home: string,
  sessionId: string,
  name: string,
  content: string | Buffer,
): string {
  const dir = join(home, "file-history", sessionId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

/** Writes `projects/<slug>/<sessionId>/subagents/agent-<name>.jsonl`. */
export function writeSubagent(
  home: string,
  cwd: string,
  sessionId: string,
  build: (c: Ctx) => (Line | string)[],
  name = "a1b2c3d4",
): string {
  const ctx: Ctx = { sessionId, cwd };
  const dir = join(home, "projects", slugFor(cwd), sessionId, "subagents");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `agent-${name}.jsonl`);
  const body = build(ctx)
    .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
    .join("\n");
  writeFileSync(file, `${body}\n`);
  return file;
}
