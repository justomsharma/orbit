import { projectName } from "../../core/paths";
import { isSessionId } from "../../core/uuid";

export const CLAUDE_EXTENSION_ID = "anthropic.claude-code";

function assertId(id: string): void {
  if (!isSessionId(id)) throw new Error("Not a Claude Code session id");
}

/**
 * Anthropic's documented deep link into the official extension's chat
 * (https://code.claude.com/docs/en/vs-code — "Launch a VS Code tab from other tools").
 * `scheme` is the running editor's own (`vscode`, `cursor`, …) so the link comes back here.
 */
export function chatUri(scheme: string, id?: string, prompt?: string): string {
  if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) throw new Error("Unsafe URI scheme");
  const q: string[] = [];
  if (id !== undefined) {
    assertId(id);
    q.push(`session=${id}`);
  }
  if (prompt) q.push(`prompt=${encodeURIComponent(prompt)}`);
  const base = `${scheme}://${CLAUDE_EXTENSION_ID}/open`;
  return q.length ? `${base}?${q.join("&")}` : base;
}

export interface TerminalSpec {
  name: string;
  shellPath: string;
  shellArgs: string[];
  cwd: string | undefined;
}

/**
 * Starts `claude` itself as the terminal's program, with the session id as an
 * argument. No shell parses anything, so nothing can be injected.
 */
export function terminalOptions(id: string, cwd: string, claudePath: string): TerminalSpec {
  assertId(id);
  return {
    name: `Claude · ${projectName(cwd)}`,
    shellPath: claudePath,
    shellArgs: ["--resume", id],
    cwd: cwd || undefined,
  };
}

const posixQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A command the person can paste into their own terminal. PowerShell on Windows, POSIX sh elsewhere. */
export function resumeCommand(id: string, cwd: string, platform: NodeJS.Platform): string {
  assertId(id);
  const run = `claude --resume ${id}`;
  if (!cwd) return run;
  return platform === "win32"
    ? `Set-Location -LiteralPath ${psQuote(cwd)}; ${run}`
    : `cd ${posixQuote(cwd)} && ${run}`;
}

/** From `where`/`which` output, the best `claude` to run. Native `.exe` beats npm's `.cmd` shim. */
export function pickClaudePath(hits: string[], platform: NodeJS.Platform): string | null {
  const clean = hits.map((h) => h.trim()).filter(Boolean);
  if (platform === "win32") {
    const exe = clean.find((h) => h.toLowerCase().endsWith(".exe"));
    if (exe) return exe;
  }
  return clean[0] ?? null;
}
