/**
 * Input rules shared by the webview forms and the message schema, so a form
 * never sends something the host would drop.
 */

export const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const ITEM_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX = { word: 500, args: 50, hook: 2000, matcher: 200, description: 500 } as const;

/** MCP servers are often local (http://localhost:3000/mcp): http and https only. */
export function isServerUrl(u: string): boolean {
  if (u.length > 2048) return false;
  try {
    return ["http:", "https:"].includes(new URL(u).protocol);
  } catch {
    return false;
  }
}

/**
 * Splits a command line into words. "Double" or 'single' quotes keep spaces
 * together (paths like C:\Users\Ana Maria\srv.exe); backslashes are literal.
 * Null when a quote is left open.
 */
export function splitCommand(line: string): string[] | null {
  const words: string[] = [];
  let cur = "";
  let inWord = false;
  let quote: string | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) words.push(cur);
      cur = "";
      inWord = false;
    } else {
      cur += ch;
      inWord = true;
    }
  }
  if (quote) return null;
  if (inWord) words.push(cur);
  return words;
}

export function mcpFormError(f: {
  name: string;
  transport: "stdio" | "http" | "sse";
  command: string;
  url: string;
}): string | null {
  const name = f.name.trim();
  if (!name) return "Give the server a name.";
  if (!MCP_NAME.test(name))
    return "Use up to 64 letters, numbers, dots, dashes or underscores for the name (no spaces).";
  if (f.transport !== "stdio")
    return isServerUrl(f.url.trim()) ? null : "The URL must start with http:// or https://.";
  const words = splitCommand(f.command);
  if (words === null) return "A quote in the command isn't closed.";
  if (!words.length) return "Enter the command that starts the server.";
  if (words.length > MAX.args + 1) return "That command has too many parts.";
  if (words.some((w) => w.length > MAX.word)) return "Part of that command is too long.";
  return null;
}

export function hookFormError(f: { command: string; matcher: string }): string | null {
  if (!f.command.trim()) return "Enter the command the hook runs.";
  if (f.command.trim().length > MAX.hook) return "That command is too long.";
  if (f.matcher.length > MAX.matcher) return "That tool pattern is too long.";
  return null;
}

export function itemFormError(f: { name: string; description: string }): string | null {
  if (!ITEM_NAME.test(f.name)) return "Give it a name: lowercase letters, numbers and dashes.";
  if (!f.description.trim()) return "Add a description so Claude knows when to use it.";
  if (f.description.trim().length > MAX.description) return "That description is too long.";
  return null;
}

/** Programs Windows can only start through cmd (npm's shims and batch files). */
const NEEDS_CMD = /^(npx|npm|pnpm|pnpx|yarn|bunx)$|\.(cmd|bat)$/i;

/**
 * On native Windows, Claude Code's docs say stdio servers started with npx
 * (and other script shims) need `cmd /c` in front.
 */
export function windowsLaunch(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  const base = command.split(/[\\/]/).pop() ?? command;
  return NEEDS_CMD.test(base)
    ? { command: "cmd", args: ["/c", command, ...args] }
    : { command, args };
}
