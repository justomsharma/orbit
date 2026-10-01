/** Claude Code's permission modes with the names people see in Orbit. */
export const MODE_LABELS: Record<string, string> = {
  default: "Ask before acting (default)",
  acceptEdits: "Edit files without asking",
  plan: "Plan first",
  auto: "Auto (Claude decides what's safe)",
  dontAsk: "Don't ask (deny what isn't allowed)",
  bypassPermissions: "Bypass all checks (sandboxes only)",
};

const WHERE: Record<string, string> = {
  user: "in every project",
  project: "for everyone using this repository",
  local: "in this folder",
};

/** How long Claude Code keeps chats unless told otherwise. */
const CLAUDE_KEEPS_DAYS = 30;

/**
 * A plain-language warning for a change that removes one of Claude's safety
 * checks, shown in the confirm dialog. Null for everything else.
 */
export function riskWarning(key: string, value: unknown, scope: string): string | null {
  const where = WHERE[scope] ?? "";
  if (key === "permissions.defaultMode" && value === "bypassPermissions")
    return `Claude will run every command and change every file without asking, ${where}. Only use this inside a sandbox or container you trust.`;
  if (key === "permissions.defaultMode" && value === "acceptEdits")
    return `Claude will edit files without asking first, ${where}.`;
  if (key === "permissions.defaultMode" && value === "auto")
    return `Claude will decide for itself which actions are safe to take without asking, ${where}.`;
  if (key === "cleanupPeriodDays" && typeof value === "number" && value < CLAUDE_KEEPS_DAYS)
    return `Next time it starts, Claude Code will delete chats, checkpoints and backups older than ${value} day${value === 1 ? "" : "s"}. Orbit can't bring them back.`;
  if (key === "sandbox.enabled" && value !== true)
    return `Claude's shell commands will run with full access to your files and network, ${where}.`;
  if (key === "permissions.disableBypassPermissionsMode" && value !== "disable")
    return `Chats will be able to switch to bypass-permissions mode again, ${where}.`;
  if (value !== true) return null;
  switch (key) {
    case "enableAllProjectMcpServers":
      return `Claude will start every MCP server a project's .mcp.json lists without asking, ${where} — including repositories you clone. Only turn this on if you trust every project you open.`;
    case "skipDangerousModePermissionPrompt":
      return "Claude will stop showing its warning before bypass-permissions mode.";
    case "skipWebFetchPreflight":
      return "Claude will stop checking web addresses against its blocklist before fetching them.";
    default:
      return null;
  }
}
