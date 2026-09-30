import { samePath } from "../core/paths";
import {
  CLAUDE_EXTENSION_ID,
  chatUri,
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
}

const INSTALL_DOCS = "https://code.claude.com/docs/en/setup";

export class Opener {
  constructor(private readonly host: OpenerHost) {}

  claudeExtensionInstalled(): boolean {
    return this.host.claudeExtensionInstalled();
  }

  private inWorkspace(cwd: string): boolean {
    return this.host.workspaceFolders().some((f) => samePath(f, cwd, this.host.platform));
  }

  /** Continue a chat in Claude's own chat panel, or explain the alternative. */
  async continueChat(s: Session): Promise<void> {
    const h = this.host;
    if (!h.claudeExtensionInstalled()) {
      const pick = await h.ask(
        "The Claude Code extension isn't installed, so this chat can't open in its panel.",
        "Continue in terminal",
        "Install extension",
      );
      if (pick === "Continue in terminal") await this.continueInTerminal(s);
      if (pick === "Install extension")
        await h.openExternal(`${h.uriScheme}:extension/${CLAUDE_EXTENSION_ID}`);
      return;
    }
    if (!this.inWorkspace(s.cwd)) {
      // Claude's panel can only resume chats that belong to the open folder.
      const pick = await h.ask(
        `This chat is from "${s.project}" (${s.cwd}), which isn't the folder open here.`,
        "Continue in terminal",
        "Copy command",
      );
      if (pick === "Continue in terminal") await this.continueInTerminal(s);
      if (pick === "Copy command") await this.copyResume(s);
      return;
    }
    await h.openExternal(chatUri(h.uriScheme, s.id));
  }

  /** Continue a chat by running `claude --resume <id>` as a new terminal's program. */
  async continueInTerminal(s: Session): Promise<void> {
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
      if (pick === "Copy command") await this.copyResume(s);
      if (pick === "How to install") await h.openExternal(INSTALL_DOCS);
      return;
    }
    h.createTerminal(terminalOptions(s.id, s.cwd, claude));
  }

  async copyResume(s: Session): Promise<void> {
    await this.host.copy(resumeCommand(s.id, s.cwd, this.host.platform));
    this.host.info("Copied. Paste it into a terminal to continue this chat.");
  }
}
