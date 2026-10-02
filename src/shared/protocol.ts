import * as v from "valibot";
import type { SetupSnapshot } from "../extension/setupService";
import type { UsageSnapshot } from "../extension/usageService";
import type { AccountSnapshot } from "../features/account/accounts";
import type { ConversationPage } from "../features/chats/conversation";
import type { MessageHit } from "../features/chats/search";
import type { LiveStatus, Session } from "../features/chats/types";
import type { PromptEntry } from "../features/prompts/library";
import type { SettingDef } from "../features/setup/catalog";
import type { MemoryFile } from "../features/setup/memory";
import type { CheckpointSummary } from "../features/timeline/summary";
import type { ChangedFile, FileVersion } from "../features/timeline/types";
import { ORBIT_LINK_IDS } from "./links";
import type { Onboarding } from "./onboarding";
import { READINGS, TAB_IDS, type Tab } from "./tabs";
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

/** Anthropic account ids are UUIDs; this only keeps the id safe to use as a key. */
const AccountId = v.pipe(v.string(), v.regex(/^[\w-]{1,100}$/));

export const OPEN_CHATS_IN = ["terminal", "claudePanel", "auto", "ask"] as const;
export const TERMINAL_LOCATIONS = ["editor", "panel"] as const;
export const EDITOR_POSITIONS = ["beside", "active", "one", "two", "three"] as const;
export const DATE_FILTERS = ["recent", "week", "month", "all"] as const;

/** The longest prompt Home's "What should Claude do?" box takes. */
export const MAX_ASK = 10_000;

/** Messages the webview may send. Anything else is dropped by the host. */
export const ViewMsgSchema = v.variant("type", [
  v.object({ type: v.literal("ready") }),
  v.object({ type: v.literal("refresh") }),
  /** VS Code's settings, filtered to Orbit's own. */
  v.object({ type: v.literal("openOrbitSettings") }),
  /** A tab crashed: a short note for Orbit's log. */
  v.object({
    type: v.literal("viewError"),
    where: v.pipe(v.string(), v.maxLength(60)),
    message: v.pipe(v.string(), v.maxLength(500)),
  }),
  /** Config's backup and help buttons: run one of Orbit's own commands. */
  v.object({
    type: v.literal("orbitCommand"),
    id: v.picklist(["exportBrain", "importBrain", "runDiagnostics", "reportProblem"]),
  }),
  v.object({ type: v.literal("openChat"), id: SessionId }),
  v.object({ type: v.literal("openTerminal"), id: SessionId }),
  v.object({ type: v.literal("forkChat"), id: SessionId }),
  v.object({ type: v.literal("copyResume"), id: SessionId }),
  v.object({ type: v.literal("pin"), id: SessionId, on: v.boolean() }),
  v.object({
    type: v.literal("rename"),
    id: SessionId,
    title: v.pipe(v.string(), v.maxLength(200)),
  }),
  v.object({
    type: v.literal("tags"),
    id: SessionId,
    tags: v.pipe(v.array(v.pipe(v.string(), v.maxLength(40))), v.maxLength(20)),
  }),
  v.object({
    type: v.literal("onboarding"),
    action: v.picklist(["find", "dismiss", "tour", "welcomed"]),
  }),
  v.object({ type: v.literal("openLink"), url: HttpsUrl }),
  v.object({ type: v.literal("openOrbitLink"), link: v.picklist(ORBIT_LINK_IDS) }),
  v.object({
    type: v.picklist([
      "account:login",
      "account:logout",
      "account:save",
      "account:pick",
      "account:restoreConfig",
    ]),
  }),
  v.object({ type: v.picklist(["account:switch", "account:remove"]), id: AccountId }),
  v.variant("key", [
    v.object({
      type: v.literal("setPref"),
      key: v.literal("openChatsIn"),
      value: v.picklist(OPEN_CHATS_IN),
    }),
    v.object({
      type: v.literal("setPref"),
      key: v.literal("editorPosition"),
      value: v.picklist(EDITOR_POSITIONS),
    }),
    v.object({
      type: v.literal("setPref"),
      key: v.literal("defaultFilter"),
      value: v.picklist(DATE_FILTERS),
    }),
    v.object({
      type: v.literal("setPref"),
      key: v.literal("defaultProject"),
      value: v.picklist(["current", "all"]),
    }),
    v.object({
      type: v.literal("setPref"),
      key: v.literal("keepSessionNames"),
      value: v.boolean(),
    }),
    v.object({
      type: v.literal("setPref"),
      key: v.literal("density"),
      value: v.picklist(["comfortable", "compact"]),
    }),
    v.object({
      type: v.literal("setPref"),
      key: v.picklist(["tabOrder", "hiddenTabs"]),
      value: v.pipe(v.array(v.picklist(TAB_IDS)), v.maxLength(30)),
    }),
    v.object({
      type: v.literal("setPref"),
      key: v.literal("restoreCount"),
      value: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12)),
    }),
    v.object({
      type: v.literal("setPref"),
      key: v.literal("terminalLocation"),
      value: v.picklist(["editor", "panel"]),
    }),
  ]),
  v.object({ type: v.literal("continueLast") }),
  v.object({
    type: v.literal("newChat"),
    prompt: v.optional(v.pipe(v.string(), v.maxLength(MAX_ASK))),
  }),
  v.object({ type: v.literal("quota"), on: v.boolean() }),
  v.object({ type: v.literal("copyRecap") }),
  v.object({
    type: v.literal("tab"),
    tab: v.picklist(READINGS),
  }),
  v.object({
    type: v.literal("saveRecapImage"),
    dataUrl: PngDataUrl,
    which: v.optional(v.picklist(["week", "year"])),
  }),
  ...setupMessages(),
  ...chatsMessages(),
]);

/** Chats tab: file timeline, transcripts, prompts and search. The host re-checks every id. */
function chatsMessages() {
  const Version = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000));
  const FilePath = v.pipe(v.string(), v.minLength(1), v.maxLength(4096));
  const PromptId = v.pipe(v.string(), v.regex(/^[0-9a-f]{12}$/));
  return [
    v.object({ type: v.literal("chat:details"), id: SessionId }),
    /** Checkpoints tab: one chat's files, with backups no file explains. */
    v.object({ type: v.literal("cp:files"), id: SessionId }),
    /** Open a file this chat changed, as it is now. */
    v.object({ type: v.literal("cp:openFile"), id: SessionId, path: FilePath }),
    v.object({ type: v.literal("chat:diff"), id: SessionId, path: FilePath, version: Version }),
    v.object({ type: v.literal("chat:restore"), id: SessionId, path: FilePath, version: Version }),
    v.object({ type: v.literal("chat:transcript"), id: SessionId }),
    v.object({ type: v.literal("chat:export"), id: SessionId }),
    v.object({
      type: v.literal("chat:conversation"),
      id: SessionId,
      order: v.picklist(["latest", "earliest"]),
      query: v.pipe(v.string(), v.maxLength(200)),
      limit: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100_000)),
      req: v.pipe(v.string(), v.maxLength(40)),
    }),
    v.object({
      type: v.literal("chat:mark"),
      ids: v.pipe(v.array(SessionId), v.minLength(1), v.maxLength(5000)),
      set: v.picklist(["archived", "hidden", "temp"]),
      on: v.boolean(),
    }),
    v.object({
      type: v.literal("chat:pinMany"),
      ids: v.pipe(v.array(SessionId), v.minLength(1), v.maxLength(500)),
      on: v.boolean(),
    }),
    v.object({ type: v.literal("chat:copyId"), id: SessionId }),
    v.object({ type: v.literal("chat:openFolder"), id: SessionId }),
    v.object({
      type: v.literal("chat:askAgain"),
      id: SessionId,
      text: v.pipe(v.string(), v.minLength(1), v.maxLength(10_000)),
    }),
    v.object({
      type: v.literal("chat:save"),
      ids: v.pipe(v.array(SessionId), v.minLength(1), v.maxLength(5000)),
    }),
    v.object({ type: v.literal("chats:import"), many: v.boolean() }),
    v.object({ type: v.literal("chats:restore") }),
    v.object({ type: v.literal("chats:newTemp") }),
    v.object({ type: v.literal("prompts:list") }),
    v.object({ type: v.literal("prompts:copy"), id: PromptId }),
    v.object({ type: v.literal("prompts:use"), id: PromptId }),
    v.object({
      type: v.literal("search"),
      query: v.pipe(v.string(), v.maxLength(200)),
      req: v.pipe(v.string(), v.maxLength(40)),
      /** Only these chats (the ones the view shows); all chats when left out. */
      ids: v.optional(v.pipe(v.array(SessionId), v.maxLength(50_000))),
    }),
  ] as const;
}

/** Setup tab messages. Every value is bounded here and checked again by the host. */
function setupMessages() {
  const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
  const nonEmpty = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max));
  const EditScope = v.picklist(["user", "project", "local"]);
  // "auto": the file that decides the value now (see toggleScope).
  const ToggleScope = v.picklist(["user", "project", "local", "auto"]);
  const McpName = v.pipe(v.string(), v.regex(MCP_NAME));
  const ItemName = v.pipe(v.string(), v.regex(ITEM_NAME));
  /** A skill an agent loads: its name, maybe with a plugin prefix. */
  const ItemNameLoose = v.pipe(v.string(), v.regex(/^[\w.:-]{1,128}$/));
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
      /** Config's quick settings: no question first unless the change is risky (still undoable). */
      quick: v.optional(v.boolean()),
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
      env: v.optional(
        v.pipe(
          v.record(v.pipe(v.string(), v.regex(/^[A-Za-z_][A-Za-z0-9_]{0,100}$/)), text(4000)),
          v.check((o) => Object.keys(o).length <= 50),
        ),
      ),
      headers: v.optional(
        v.pipe(
          v.record(v.pipe(v.string(), v.regex(/^[A-Za-z0-9-]{1,100}$/)), text(4000)),
          v.check((o) => Object.keys(o).length <= 50),
        ),
      ),
      /** Editing: the server's current name (it is replaced, its secret values kept). */
      replace: v.optional(McpName),
    }),
    v.object({
      type: v.literal("setup:run"),
      what: v.picklist([
        "mcpList",
        "mcpGet",
        "mcpLogout",
        "slashMcp",
        "slashHooks",
        "slashConfig",
        "slashAgents",
        "slashPlugin",
        "slashMemory",
        "slashStatusline",
        "slashDoctor",
      ]),
      name: v.optional(McpName),
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
    /** Folders Claude may use besides the project: add (Orbit asks for the folder) or remove one. */
    v.object({
      type: v.literal("setup:dir"),
      op: v.picklist(["add", "remove"]),
      scope: EditScope,
      dir: v.optional(FilePath),
    }),
    /** Settings history: Orbit's own changes and its trash. */
    v.object({ type: v.literal("history:list") }),
    v.object({ type: v.literal("history:undo"), id: v.pipe(v.string(), v.uuid()) }),
    v.object({ type: v.literal("history:restore"), id: v.pipe(v.string(), v.uuid()) }),
    v.object({ type: v.literal("history:forget"), id: v.pipe(v.string(), v.uuid()) }),
    /** Config: clear ~/.claude/settings.json (backed up, undoable). */
    v.object({ type: v.literal("setup:resetUserSettings") }),
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
    /** Agent form: a new agent (scope) or changes to one (file). */
    v.object({
      type: v.literal("setup:agentSave"),
      req: Req,
      file: v.optional(FilePath),
      scope: v.optional(v.picklist(["user", "project"])),
      name: ItemName,
      description: nonEmpty(1000),
      model: v.nullable(v.pipe(v.string(), v.regex(/^[\w.[\]-]{1,100}$/))),
      tools: v.pipe(v.array(nonEmpty(200)), v.maxLength(100)),
      skills: v.pipe(v.array(ItemNameLoose), v.maxLength(50)),
      prompt: text(100_000),
    }),
    v.object({ type: v.literal("setup:agentDuplicate"), file: FilePath }),
    /** Memory: another project's memories (by its folder name in ~/.claude/projects). */
    v.object({
      type: v.literal("setup:memoryOf"),
      slug: v.pipe(v.string(), v.regex(/^[\w.-]{1,300}$/)),
    }),
    /** Show a memory file in the file manager. */
    v.object({ type: v.literal("setup:revealFile"), file: FilePath }),
    /** Show an installed plugin's folder in the file manager. */
    v.object({
      type: v.literal("setup:revealPlugin"),
      id: v.pipe(v.string(), v.maxLength(200), v.regex(/^[^@\s]+@[^@\s]+$/)),
    }),
    /** Pause one hook (Orbit keeps it) or put a paused one back. */
    v.object({ type: v.literal("setup:hookPause"), id: v.pipe(v.string(), v.maxLength(2000)) }),
    v.object({ type: v.literal("setup:hookResume"), id: v.pipe(v.string(), v.uuid()) }),
    v.object({
      type: v.literal("setup:hookEdit"),
      req: Req,
      id: v.pipe(v.string(), v.maxLength(2000)),
      scope: v.picklist(["user", "project", "local"]),
      event: v.pipe(v.string(), v.maxLength(100)),
      matcher: v.nullable(text(500)),
      command: nonEmpty(4000),
      timeout: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3600))),
    }),
    /** A detail page wants a skill's, agent's, command's or memory file's text. */
    v.object({ type: v.literal("setup:read"), file: FilePath }),
    /** Start a chat with this skill or command typed in (not sent). */
    v.object({ type: v.literal("setup:launch"), file: FilePath }),
    /** The same for one of Claude Code's built-in commands. */
    v.object({ type: v.literal("setup:launchBuiltin"), name: ItemName }),
    /** Delete a skill, agent, command or memory file: moved to Orbit's trash, with Undo. */
    v.object({ type: v.literal("setup:trash"), file: FilePath }),
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

/** A changed file as the view sees it: no blob paths, only what it shows. */
export type ChangedFileView = Omit<ChangedFile, "versions"> & {
  versions: Pick<FileVersion, "version" | "at" | "available" | "bytes">[];
};

export interface Environment {
  /** Anthropic's Claude Code extension is installed. */
  claudeExtension: boolean;
  /** A folder is open in this window. */
  hasWorkspace: boolean;
  platform: string;
  /** Orbit's own VS Code settings that its views show. */
  prefs?: OrbitPrefs;
}

export interface OrbitPrefs {
  openChatsIn: (typeof OPEN_CHATS_IN)[number];
  terminalLocation: (typeof TERMINAL_LOCATIONS)[number];
  editorPosition?: (typeof EDITOR_POSITIONS)[number];
  /** The Chats tab's starting filters. */
  defaultFilter?: (typeof DATE_FILTERS)[number];
  defaultProject?: "current" | "all";
  keepSessionNames?: boolean;
  restoreCount?: number;
  /** Tighter rows for small sidebars. */
  density?: "comfortable" | "compact";
  /** Orbit's tabs: your order, and the ones you hid. */
  tabOrder?: Tab[];
  hiddenTabs?: Tab[];
}

/** Messages the host sends to the webview. */
export type HostMsg =
  | {
      type: "sessions";
      items: Session[];
      live: LiveStatus[];
      pins: string[];
      renames: Record<string, string>;
      /** Orbit-only tags per chat. */
      tags: Record<string, string[]>;
      /** Getting-started checklist progress. */
      onboarding?: Onboarding;
      /** Ids of chats that belong to a folder open in this window. */
      here: string[];
      env: Environment;
      /** Orbit's own lists: archived, hidden (Orbit's "delete") and temporary chats. */
      archived?: string[];
      hidden?: string[];
      temp?: string[];
      /** Running chats whose terminal Orbit can show. */
      terminals?: string[];
    }
  | { type: "usage"; data: UsageSnapshot }
  | { type: "account"; data: AccountSnapshot }
  | { type: "chat:conversation"; id: string; req: string; page: ConversationPage }
  | { type: "checkpoints"; items: CheckpointSummary[] }
  /** Open a tab (from a command or the Get started walkthrough). */
  | { type: "goto"; tab: Tab }
  | { type: "setup"; data: SetupSnapshot }
  /** Orbit's changes (undoable) and what's in its trash, newest first. */
  | {
      type: "history";
      edits: { id: string; label: string; file: string; at: number }[];
      trash: { id: string; label: string; original: string; at: number }[];
    }
  /** Another project's memories, for Memory's project picker. */
  | { type: "setup:memoryFiles"; slug: string; files: MemoryFile[] }
  /** A file's text for a detail page; null when it can't be read or is too large (`truncated`). */
  | { type: "setup:content"; file: string; text: string | null; truncated: boolean }
  | { type: "catalog"; data: SettingDef[] }
  | { type: "chat:details"; id: string; files: ChangedFileView[] }
  /** `gone`: the chat's transcript is no longer on disk; only its backups are. */
  | { type: "cp:files"; id: string; gone: boolean; files: ChangedFileView[]; orphans: number }
  | { type: "prompts"; items: PromptEntry[]; error?: string }
  /** Search results for request `req`; `done` false while more chats are still being read. */
  | {
      type: "search";
      req: string;
      hits: MessageHit[];
      done: boolean;
      /** How many chats were read so far, of `total`. */
      searched?: number;
      total?: number;
      /** Stopped at the most chats it shows; there may be more. */
      capped?: boolean;
    }
  /** Whether the change a form asked for (by its request id) was made. */
  | { type: "setup:result"; req: string; ok: boolean }
  | { type: "loading" }
  | { type: "error"; text: string };
