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
 * argument. For a native executable no shell parses anything. For npm's `.cmd`
 * shim Windows runs it through cmd.exe, which re-parses arguments — safe only
 * because the id is a validated UUID and `--resume` is constant. Never add
 * free-text arguments here.
 */
/** `fork`: Claude's --fork-session, a new chat that starts from this one's history. */
export interface ResumeOptions {
  fork?: boolean;
}

export function terminalOptions(
  id: string,
  cwd: string,
  claudePath: string,
  o: ResumeOptions = {},
): TerminalSpec {
  assertId(id);
  return {
    name: `Claude · ${projectName(cwd)}${o.fork ? " (new branch)" : ""}`,
    shellPath: claudePath,
    shellArgs: ["--resume", id, ...(o.fork ? ["--fork-session"] : [])],
    cwd: cwd || undefined,
  };
}

const posixQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
// PowerShell also treats the curly quotes ‘ ’ ‚ ‛ as single quotes, so they are doubled too.
const psQuote = (s: string) => `'${s.replace(/['‘’‚‛]/g, (q) => q + q)}'`;

/** A command the person can paste into their own terminal. PowerShell on Windows, POSIX sh elsewhere. */
export function resumeCommand(
  id: string,
  cwd: string,
  platform: NodeJS.Platform,
  o: ResumeOptions = {},
): string {
  assertId(id);
  const run = `claude --resume ${id}${o.fork ? " --fork-session" : ""}`;
  if (!cwd) return run;
  return platform === "win32"
    ? `Set-Location -LiteralPath ${psQuote(cwd)}; ${run}`
    : `cd ${posixQuote(cwd)} && ${run}`;
}

/**
 * From `where`/`which` output, the best `claude` to run. On Windows a native
 * `.exe` wins, then npm's `.cmd`/`.bat` shim; npm's extensionless POSIX script
 * (listed first by `where`) cannot be started by Windows and is never picked.
 */
export function pickClaudePath(hits: string[], platform: NodeJS.Platform): string | null {
  const clean = hits.map((h) => h.trim()).filter(Boolean);
  if (platform !== "win32") return clean[0] ?? null;
  for (const ext of [".exe", ".cmd", ".bat", ".com"]) {
    const hit = clean.find((h) => h.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  return null;
}

/** A terminal running a fresh `claude` session in `cwd`. */
export function newChatTerminal(cwd: string | undefined, claudePath: string): TerminalSpec {
  return {
    name: cwd ? `Claude · ${projectName(cwd)}` : "Claude",
    shellPath: claudePath,
    shellArgs: [],
    cwd,
  };
}
