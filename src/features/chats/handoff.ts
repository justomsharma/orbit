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
  /** The chat it continues, so Orbit can show this terminal later. */
  sessionId?: string;
}

/** A terminal tab name from a chat title (Claude Code renames it while working anyway). */
export function terminalName(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length > 24 ? `${t.slice(0, 23)}…` : t || "Claude";
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
  /** The chat's title, for the terminal tab. */
  title?: string;
}

export function terminalOptions(
  id: string,
  cwd: string,
  claudePath: string,
  o: ResumeOptions = {},
): TerminalSpec {
  assertId(id);
  return {
    name: o.title
      ? terminalName(`${o.fork ? "Fork: " : ""}${o.title}`)
      : `Claude · ${projectName(cwd)}${o.fork ? " (new branch)" : ""}`,
    shellPath: claudePath,
    shellArgs: ["--resume", id, ...(o.fork ? ["--fork-session"] : [])],
    cwd: cwd || undefined,
    ...(o.fork ? {} : { sessionId: id }),
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

/**
 * Can `prompt` be given to `claude` as its first-message argument? Only for a real
 * executable: Windows runs npm's `.cmd`/`.bat` shims through cmd.exe, which would
 * re-parse free text. Text that looks like an option, or (on Windows) spans lines or
 * has characters cmd.exe treats specially, goes on the clipboard instead.
 */
export function promptIsSafeArg(
  prompt: string,
  claudePath: string,
  platform: NodeJS.Platform,
): boolean {
  if (!prompt.trim() || prompt.length > 8000 || /^\s*-/.test(prompt) || prompt.includes("\0"))
    return false;
  if (platform !== "win32") return true;
  // Some `.exe` launchers (scoop shims) hand the line to a `.cmd` file, which cmd.exe
  // re-parses: text with its special characters goes on the clipboard instead.
  return /\.(exe|com)$/i.test(claudePath) && !/[\r\n"&|<>^%!`]/.test(prompt);
}

/** A terminal running a fresh `claude` session in `cwd`, optionally with its first message. */
export function newChatTerminal(
  cwd: string | undefined,
  claudePath: string,
  prompt?: string,
  platform: NodeJS.Platform = process.platform,
): TerminalSpec {
  return {
    name: cwd ? `Claude · ${projectName(cwd)}` : "Claude",
    shellPath: claudePath,
    shellArgs: prompt && promptIsSafeArg(prompt, claudePath, platform) ? [prompt] : [],
    cwd,
  };
}

/** `claude --continue`: the most recent chat in `cwd`. */
export function continueLastTerminal(cwd: string | undefined, claudePath: string): TerminalSpec {
  return {
    name: cwd ? `Claude · ${projectName(cwd)}` : "Claude",
    shellPath: claudePath,
    shellArgs: ["--continue"],
    cwd,
  };
}
