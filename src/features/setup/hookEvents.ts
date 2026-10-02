/** Claude Code hook events (from the official settings schema, `hooks.properties`). */
export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "Elicitation",
  "ElicitationResult",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "Setup",
  "InstructionsLoaded",
  "CwdChanged",
  "FileChanged",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "DirectoryAdded",
  "MessageDisplay",
  "SessionStart",
  "SessionEnd",
] as const;

/** Each event in plain words: a short title and when it runs. */
export const HOOK_INFO: Record<string, { title: string; when: string }> = {
  PreToolUse: {
    title: "Before a tool runs",
    when: "Before Claude uses a tool. It can block the tool.",
  },
  PostToolUse: { title: "After a tool runs", when: "After a tool finishes successfully." },
  PostToolUseFailure: { title: "After a tool fails", when: "After a tool call fails." },
  PostToolBatch: { title: "After a batch of tools", when: "After a group of tool calls finishes." },
  PermissionRequest: {
    title: "When Claude asks permission",
    when: "When Claude asks to use a tool.",
  },
  PermissionDenied: { title: "When permission is denied", when: "When a tool use is refused." },
  Notification: {
    title: "When Claude notifies you",
    when: "When Claude sends a notification, like waiting for you.",
  },
  UserPromptSubmit: {
    title: "When you send a prompt",
    when: "When you send a prompt, before Claude reads it.",
  },
  UserPromptExpansion: {
    title: "When a prompt expands",
    when: "When a command or shortcut expands into a prompt.",
  },
  Stop: { title: "When Claude finishes", when: "When Claude finishes its reply." },
  StopFailure: { title: "When a reply fails", when: "When a reply ends with an error." },
  SubagentStart: { title: "When a subagent starts", when: "When Claude hands work to a subagent." },
  SubagentStop: { title: "When a subagent finishes", when: "When a subagent finishes its work." },
  PreCompact: {
    title: "Before compacting",
    when: "Before the conversation is summarized to free up context.",
  },
  PostCompact: { title: "After compacting", when: "After the conversation was summarized." },
  Elicitation: {
    title: "When an MCP server asks you",
    when: "When an MCP server asks you for input.",
  },
  ElicitationResult: {
    title: "After you answer an MCP server",
    when: "After you answer an MCP server's question.",
  },
  TeammateIdle: {
    title: "When a teammate is idle",
    when: "When an agent teammate has nothing to do.",
  },
  TaskCreated: { title: "When a task is created", when: "When a task is added." },
  TaskCompleted: { title: "When a task is done", when: "When a task is marked complete." },
  Setup: { title: "During setup", when: "When Claude Code runs its setup." },
  InstructionsLoaded: {
    title: "When instructions load",
    when: "When CLAUDE.md or rule files are loaded.",
  },
  CwdChanged: { title: "When the folder changes", when: "When the working folder changes." },
  FileChanged: { title: "When a file changes", when: "When a watched file changes on disk." },
  ConfigChange: { title: "When settings change", when: "When a settings file changes." },
  WorktreeCreate: { title: "When a worktree is made", when: "When a git worktree is created." },
  WorktreeRemove: { title: "When a worktree is removed", when: "When a git worktree is removed." },
  DirectoryAdded: {
    title: "When a folder is added",
    when: "When a working folder is added, like with /add-dir.",
  },
  MessageDisplay: { title: "When a message shows", when: "When a message is shown." },
  SessionStart: { title: "When a session starts", when: "When a session starts or resumes." },
  SessionEnd: { title: "When a session ends", when: "When a session ends." },
};

/** A hook's name from what it runs: the script's file name, or the program. */
export function hookTitle(command: string | null, url: string | null): string {
  if (url) {
    try {
      return new URL(url).host || url;
    } catch {
      return url;
    }
  }
  if (!command) return "Hook";
  const words = command.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const unq = (w: string) => w.replace(/^["']|["']$/g, "");
  const RUNNERS = new Set([
    "bash",
    "sh",
    "zsh",
    "node",
    "python",
    "python3",
    "npx",
    "bun",
    "deno",
    "pwsh",
    "powershell",
    "cmd",
    "/c",
    "-c",
    "uv",
    "run",
  ]);
  const script = words
    .map(unq)
    .find((w) => /[\\/]|\.(sh|js|mjs|cjs|ts|py|ps1|bat|cmd|rb)$/i.test(w) && !w.startsWith("-"));
  const pick =
    script ??
    words.map(unq).find((w) => !RUNNERS.has(w.toLowerCase()) && !w.startsWith("-")) ??
    unq(words[0] ?? "");
  const base = pick.split(/[\\/]/).filter(Boolean).pop() ?? pick;
  return base.length > 40 ? `${base.slice(0, 39)}…` : base || "Hook";
}

/** Events whose `matcher` filters tool names (others ignore it or use their own values). */
export const TOOL_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
]);

/** "effortLevel" → "Effort level" for people-facing text. */
export function humanize(key: string): string {
  const last = key.split(".").pop() ?? key;
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return (
    words.charAt(0).toUpperCase() +
    words
      .slice(1)
      .toLowerCase()
      .replace(/\bmcp\b/g, "MCP")
      .replace(/\bpr\b/g, "PR")
  );
}
