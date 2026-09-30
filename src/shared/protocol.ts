import * as v from "valibot";
import type { SetupSnapshot } from "../extension/setupService";
import type { UsageSnapshot } from "../extension/usageService";
import type { LiveStatus, Session } from "../features/chats/types";
import type { SettingDef } from "../features/setup/catalog";
import { ITEM_NAME, isServerUrl, MCP_NAME } from "./validate";

const SessionId = v.pipe(
  v.string(),
  v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);

const HttpsUrl = v.pipe(
  v.string(),
  v.maxLength(2048),
  v.check((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }),
);

/** A PNG the webview rendered (the weekly recap card). Capped at 8 MB. */
const PngDataUrl = v.pipe(
  v.string(),
  v.maxLength(8 * 1024 * 1024),
  v.regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
);

/** Messages the webview may send. Anything else is dropped by the host. */
export const ViewMsgSchema = v.variant("type", [
  v.object({ type: v.literal("ready") }),
  v.object({ type: v.literal("refresh") }),
  v.object({ type: v.literal("openChat"), id: SessionId }),
  v.object({ type: v.literal("openTerminal"), id: SessionId }),
  v.object({ type: v.literal("copyResume"), id: SessionId }),
  v.object({ type: v.literal("pin"), id: SessionId, on: v.boolean() }),
  v.object({
    type: v.literal("rename"),
    id: SessionId,
    title: v.pipe(v.string(), v.maxLength(200)),
  }),
  v.object({ type: v.literal("openLink"), url: HttpsUrl }),
  v.object({ type: v.literal("newChat") }),
  v.object({ type: v.literal("quota"), on: v.boolean() }),
  v.object({ type: v.literal("copyRecap") }),
  v.object({ type: v.literal("tab"), tab: v.picklist(["home", "chats", "usage", "setup"]) }),
  v.object({ type: v.literal("saveRecapImage"), dataUrl: PngDataUrl }),
  ...setupMessages(),
]);

/** Setup tab messages. Every value is bounded here and checked again by the host. */
function setupMessages() {
  const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
  const nonEmpty = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max));
  const EditScope = v.picklist(["user", "project", "local"]);
  // "auto": the file that decides the value now (see toggleScope).
  const ToggleScope = v.picklist(["user", "project", "local", "auto"]);
  const McpName = v.pipe(v.string(), v.regex(MCP_NAME));
  const ItemName = v.pipe(v.string(), v.regex(ITEM_NAME));
  // A form's request id; the host replies with setup:result so the form knows to close.
  const Req = v.optional(v.pipe(v.string(), v.maxLength(40)));
  const Key = v.pipe(
    v.string(),
    v.regex(/^[A-Za-z][A-Za-z0-9]{0,79}(\.[A-Za-z][A-Za-z0-9]{0,79})?$/),
  );
  const FilePath = nonEmpty(1024);
  const McpUrl = v.pipe(v.string(), v.check(isServerUrl));
  return [
    v.object({ type: v.literal("setup:refresh") }),
    v.object({
      type: v.literal("setup:setSetting"),
      scope: ToggleScope,
      key: Key,
      value: v.union([v.pipe(v.string(), v.maxLength(2000)), v.number(), v.boolean(), v.null()]),
    }),
    v.object({
      type: v.literal("setup:plugin"),
      id: v.pipe(v.string(), v.maxLength(200), v.regex(/^[^@\s]+@[^@\s]+$/)),
      enabled: v.boolean(),
      scope: ToggleScope,
    }),
    v.object({
      type: v.literal("setup:mcpApproval"),
      name: McpName,
      state: v.picklist(["approved", "rejected"]),
    }),
    v.object({ type: v.literal("setup:mcpRemove"), scope: EditScope, name: McpName }),
    v.object({
      type: v.literal("setup:mcpAdd"),
      req: Req,
      scope: EditScope,
      name: McpName,
      transport: v.picklist(["stdio", "http", "sse"]),
      command: v.optional(nonEmpty(500)),
      args: v.optional(v.pipe(v.array(text(500)), v.maxLength(50))),
      url: v.optional(McpUrl),
    }),
    v.object({ type: v.literal("setup:mcpLogin"), name: McpName }),
    v.object({ type: v.literal("setup:hookRemove"), id: nonEmpty(2000) }),
    v.object({
      type: v.literal("setup:hookAdd"),
      req: Req,
      scope: EditScope,
      event: v.pipe(v.string(), v.regex(/^[A-Z][A-Za-z]{1,40}$/)),
      matcher: v.nullable(text(200)),
      command: nonEmpty(2000),
      timeout: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3600))),
    }),
    v.object({ type: v.literal("setup:hooksPaused"), paused: v.boolean() }),
    v.object({
      type: v.literal("setup:rule"),
      req: Req,
      op: v.picklist(["add", "remove"]),
      scope: EditScope,
      list: v.picklist(["allow", "ask", "deny"]),
      rule: nonEmpty(500),
    }),
    v.object({
      type: v.literal("setup:skillVisibility"),
      name: v.pipe(v.string(), v.maxLength(100)),
      visibility: v.picklist(["on", "name-only", "user-invocable-only", "off"]),
    }),
    v.object({
      type: v.literal("setup:new"),
      req: Req,
      kind: v.picklist(["skill", "agent", "command"]),
      scope: v.picklist(["user", "project"]),
      name: ItemName,
      description: nonEmpty(500),
    }),
    v.object({ type: v.literal("setup:open"), file: FilePath }),
    v.object({
      type: v.literal("setup:createClaudeMd"),
      scope: v.picklist(["user", "project", "local"]),
    }),
    v.object({ type: v.literal("setup:fixWithClaude"), issueId: nonEmpty(2000) }),
  ] as const;
}

export type ViewMsg = v.InferOutput<typeof ViewMsgSchema>;

export function parseViewMsg(raw: unknown): ViewMsg | null {
  const r = v.safeParse(ViewMsgSchema, raw);
  return r.success ? r.output : null;
}

export interface Environment {
  /** Anthropic's Claude Code extension is installed. */
  claudeExtension: boolean;
  /** A folder is open in this window. */
  hasWorkspace: boolean;
  platform: string;
}

/** Messages the host sends to the webview. */
export type HostMsg =
  | {
      type: "sessions";
      items: Session[];
      live: LiveStatus[];
      pins: string[];
      renames: Record<string, string>;
      /** Ids of chats that belong to a folder open in this window. */
      here: string[];
      env: Environment;
    }
  | { type: "usage"; data: UsageSnapshot }
  | { type: "setup"; data: SetupSnapshot }
  | { type: "catalog"; data: SettingDef[] }
  /** Whether the change a form asked for (by its request id) was made. */
  | { type: "setup:result"; req: string; ok: boolean }
  | { type: "loading" }
  | { type: "error"; text: string };
