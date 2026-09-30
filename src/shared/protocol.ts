import * as v from "valibot";
import type { LiveStatus, Session } from "../features/chats/types";

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
]);

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
  | { type: "loading" }
  | { type: "error"; text: string };
