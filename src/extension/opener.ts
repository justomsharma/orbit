import { isInside, samePath } from "../core/paths";
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
  openIn?(): "terminal" | "claudePanel";
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

  /** Continue a chat where Orbit opens chats: a terminal, or Claude's chat panel. */
  async continueChat(s: Session): Promise<void> {
    const h = this.host;
    if (this.terminalFirst()) return this.continueInTerminal(s);
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
    h.createTerminal(terminalOptions(s.id, s.cwd, claude, o));
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
