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
