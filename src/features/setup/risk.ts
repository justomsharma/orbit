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

/**
 * A plain-language warning for a change that removes one of Claude's safety
 * checks, shown in the confirm dialog. Null for everything else.
 */
export function riskWarning(key: string, value: unknown, scope: string): string | null {
  const where = WHERE[scope] ?? "";
  if (key === "permissions.defaultMode" && value === "bypassPermissions")
    return `Claude will run every command and change every file without asking, ${where}. Only use this inside a sandbox or container you trust.`;
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
