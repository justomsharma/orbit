import { isInside, samePath } from "../core/paths";
import { safeBranch } from "../features/chats/branch";
import {
  CLAUDE_EXTENSION_ID,
  chatUri,
  continueLastTerminal,
  newChatTerminal,
  promptIsSafeArg,
  type ResumeOptions,
  resumeCommand,
  type TerminalSpec,
  terminalOptions,
} from "../features/chats/handoff";
import type { Session } from "../features/chats/types";

/** Everything the opener needs from VS Code — injected so the decisions are unit-tested. */
export interface OpenerHost {
  uriScheme: string;
  platform: NodeJS.Platform;
  claudeExtensionInstalled(): boolean;
  workspaceFolders(): string[];
  findClaude(): Promise<string | null>;
  pathExists(p: string): Promise<boolean>;
  openExternal(uri: string): Promise<boolean>;
  createTerminal(spec: TerminalSpec): void;
  copy(text: string): Promise<void>;
  ask(message: string, ...actions: string[]): Promise<string | undefined>;
  info(message: string): void;
  /** Where chats open (Orbit's "Open chats in" setting). Claude's panel when not given. */
  openIn?(): "terminal" | "claudePanel" | "auto" | "ask";
  /** A running chat: show its terminal ("shown"), or Orbit doesn't know where it runs. */
  running?(id: string): "shown" | "untracked" | "no";
  /** For "ask": which one this time. */
  chooseWhere?(): Promise<"terminal" | "claudePanel" | undefined>;
  /** The branch the folder is on now (null when unknown). */
  branchOf?(cwd: string): Promise<string | null>;
  /** Runs `git checkout <branch>` in the folder; resolves to an error message, or null. */
  checkout?(cwd: string, branch: string): Promise<string | null>;
}

const INSTALL_DOCS = "https://code.claude.com/docs/en/setup";

/** Longer prompts (URL-encoded) are copied instead of typed in through the link. */
export const MAX_PROMPT_IN_LINK = 8000;

export class Opener {
  constructor(private readonly host: OpenerHost) {}

  claudeExtensionInstalled(): boolean {
    return this.host.claudeExtensionInstalled();
  }

  private inWorkspace(cwd: string): boolean {
    return this.host.workspaceFolders().some((f) => samePath(f, cwd, this.host.platform));
  }

  private terminalFirst(): boolean {
    return this.host.openIn?.() === "terminal";
  }

  /** Where this chat opens: the setting, "auto" by how the chat was started, or asked. */
  private async where(s: Session): Promise<"terminal" | "claudePanel" | null> {
    const h = this.host;
    const pref = h.openIn?.() ?? "claudePanel";
    if (pref === "ask") return (await h.chooseWhere?.()) ?? null;
    if (pref === "auto")
      return /vscode/i.test(s.entrypoint ?? "") && h.claudeExtensionInstalled()
        ? "claudePanel"
        : "terminal";
    return pref;
  }

  /** Continue a chat where Orbit opens chats: a terminal, or Claude's chat panel. */
  async continueChat(s: Session): Promise<void> {
    const h = this.host;
    // Already running: show it rather than starting it a second time.
    const r = h.running?.(s.id) ?? "no";
    if (r === "shown") return;
    if (r === "untracked") {
      h.info(
        "This chat is already running, but not in a terminal Orbit opened (another window, or a terminal started by hand). Switch to it there.",
      );
      return;
    }
    const where = await this.where(s);
    if (!where) return;
    if (where === "terminal") return this.continueInTerminal(s);
    if (!h.claudeExtensionInstalled()) {
      const pick = await h.ask(
        "The Claude Code extension isn't installed or enabled, so this chat can't open in its panel.",
        "Continue in terminal",
        "Install extension",
      );
      if (pick === "Continue in terminal") await this.continueInTerminal(s);
      if (pick === "Install extension")
        await h.openExternal(`${h.uriScheme}:extension/${CLAUDE_EXTENSION_ID}`);
      return;
    }
    if (!this.inWorkspace(s.cwd)) {
      // Claude's panel can only resume chats that belong to the open folder itself.
      const sub = h.workspaceFolders().some((f) => isInside(f, s.cwd, h.platform));
      const pick = await h.ask(
        sub
          ? `This chat started in a subfolder (${s.cwd}). Claude's panel only opens chats that belong to the open folder itself.`
          : `This chat is from "${s.project}" (${s.cwd}), which isn't the folder open here.`,
        "Continue in terminal",
        "Copy command",
      );
      if (pick === "Continue in terminal") await this.continueInTerminal(s);
      if (pick === "Copy command") await this.copyResume(s);
      return;
    }
    await h.openExternal(chatUri(h.uriScheme, s.id));
  }

  /**
   * Continue a chat by running `claude --resume <id>` as a new terminal's program.
   * With `fork`, Claude starts a new chat from its history and leaves it untouched.
   */
  async continueInTerminal(s: Session, o: ResumeOptions = {}): Promise<void> {
    const h = this.host;
    if (s.cwd && !(await h.pathExists(s.cwd))) {
      h.info(`The folder for this chat no longer exists: ${s.cwd}`);
      return;
    }
    // The chat was on another branch: Claude would work on the wrong code.
    const now = s.cwd && s.branch && h.branchOf ? await h.branchOf(s.cwd) : null;
    if (now && s.branch && now !== s.branch && !o.fork) {
      const pick = await h.ask(
        `This chat was on branch "${s.branch}", but ${s.project} is on "${now}" now.`,
        "Switch & continue",
        "Continue anyway",
      );
      if (!pick) return;
      if (pick === "Switch & continue") {
        const err = safeBranch(s.branch)
          ? ((await h.checkout?.(s.cwd, s.branch)) ?? null)
          : "That branch name isn't one Orbit will pass to git.";
        if (err) {
          h.info(`Couldn't switch to "${s.branch}": ${err}`);
          return;
        }
      }
    }
    const claude = await h.findClaude();
    if (!claude) {
      const pick = await h.ask(
        "The claude command was not found. Install Claude Code's CLI, or copy the command and run it yourself.",
        "Copy command",
        "How to install",
      );
      if (pick === "Copy command") await this.copyResume(s, o);
      if (pick === "How to install") await h.openExternal(INSTALL_DOCS);
      return;
    }
    h.createTerminal(terminalOptions(s.id, s.cwd, claude, { title: s.title, ...o }));
  }

  /**
   * Starts a new conversation. In a terminal, the prompt is sent as Claude's first
   * message when it can be passed safely, else it goes on the clipboard. In Claude's
   * panel it's typed in, not sent.
   */
  async newChat(prompt?: string): Promise<void> {
    const h = this.host;
    if (!this.terminalFirst() && h.claudeExtensionInstalled()) {
      await h.openExternal(chatUri(h.uriScheme, undefined, prompt));
      return;
    }
    const claude = await h.findClaude();
    if (claude) {
      const asArg = prompt && promptIsSafeArg(prompt, claude, h.platform) ? prompt : undefined;
      h.createTerminal(newChatTerminal(h.workspaceFolders()[0], claude, asArg, h.platform));
      if (prompt && !asArg) {
        await h.copy(prompt);
        h.info("Claude is starting in a terminal. Your prompt is copied: paste it in.");
      }
      return;
    }
    if (h.claudeExtensionInstalled()) {
      await h.openExternal(chatUri(h.uriScheme, undefined, prompt));
      return;
    }
    const pick = await h.ask(
      "Install Claude Code to start a chat: the VS Code extension, or the claude command for terminals.",
      "Install extension",
      "How to install the CLI",
    );
    if (pick === "Install extension")
      await h.openExternal(`${h.uriScheme}:extension/${CLAUDE_EXTENSION_ID}`);
    if (pick === "How to install the CLI") await h.openExternal(INSTALL_DOCS);
  }

  /** `claude --continue` in the open folder: the most recent chat there. */
  async continueLast(): Promise<void> {
    const h = this.host;
    const folder = h.workspaceFolders()[0];
    if (!folder) {
      h.info("Open a folder first: Claude continues the last chat of the open folder.");
      return;
    }
    const claude = await h.findClaude();
    if (!claude) {
      h.info(
        "The claude command was not found. Install Claude Code's CLI to continue in a terminal.",
      );
      return;
    }
    h.createTerminal(continueLastTerminal(folder, claude));
  }

  async copyResume(s: Session, o: ResumeOptions = {}): Promise<void> {
    await this.host.copy(resumeCommand(s.id, s.cwd, this.host.platform, o));
    this.host.info("Copied. Paste it into a terminal to continue this chat.");
  }
}
