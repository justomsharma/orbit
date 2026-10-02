import type { WorktreeInfo } from "./worktree";

export interface Session {
  id: string;
  /** Absolute path of the transcript file. */
  file: string;
  /** Folder the chat ran in. */
  cwd: string;
  /** Last folder name of `cwd`, for display. */
  project: string;
  title: string;
  firstPrompt: string;
  branch: string | null;
  startedAt: number;
  lastActiveAt: number;
  /** Real prompts typed by the person (meta lines and tool results excluded). */
  prompts: number;
  /** True when the transcript was too large to read fully, so `prompts` is a lower bound. */
  estimated: boolean;
  model: string | null;
  /** How the chat was started, e.g. `cli` or `claude-vscode`. */
  entrypoint: string | null;
  prLinks: string[];
  continuedIn: string | null;
  sizeBytes: number;
  /** Set when the chat's folder is a git worktree. */
  worktree?: WorktreeInfo | null;
}

/** "waiting": Claude asked for permission or asked you a question, and is waiting for you. */
export type LiveState = "busy" | "idle" | "waiting" | "unknown";

export interface LiveStatus {
  sessionId: string;
  pid: number;
  status: LiveState;
  name: string | null;
  updatedAt: number;
}
