import { stat } from "node:fs/promises";
import * as vscode from "vscode";
import { findClaude } from "../features/chats/findClaude";
import { CLAUDE_EXTENSION_ID } from "../features/chats/handoff";
import { OPEN_CHATS_IN, type OrbitPrefs, TERMINAL_LOCATIONS } from "../shared/protocol";
import type { OpenerHost } from "./opener";

/** Orbit's own settings, with safe fallbacks for unknown values. */
export function orbitPrefs(): OrbitPrefs {
  const c = vscode.workspace.getConfiguration("orbit");
  const open = c.get<string>("openChatsIn");
  const where = c.get<string>("terminalLocation");
  return {
    openChatsIn: OPEN_CHATS_IN.find((x) => x === open) ?? "terminal",
    terminalLocation: TERMINAL_LOCATIONS.find((x) => x === where) ?? "editor",
  };
}

/** Where a new Claude terminal goes: a tab beside the editor, or the bottom panel. */
function terminalLocation(): vscode.TerminalOptions["location"] {
  return orbitPrefs().terminalLocation === "panel"
    ? vscode.TerminalLocation.Panel
    : { viewColumn: vscode.ViewColumn.Active, preserveFocus: false };
}

let terminalIcon: vscode.Uri | undefined;
/** Orbit's Claude mark for terminal tabs (set once from the extension's folder). */
export function setTerminalIcon(uri: vscode.Uri): void {
  terminalIcon = uri;
}
const icon = () => terminalIcon ?? new vscode.ThemeIcon("comment-discussion");

/** The real VS Code implementation of everything the Opener needs. */
export function vscodeOpenerHost(): OpenerHost {
  let claudePath: string | null = null;
  return {
    uriScheme: vscode.env.uriScheme,
    platform: process.platform,
    claudeExtensionInstalled: () =>
      vscode.extensions.getExtension(CLAUDE_EXTENSION_ID) !== undefined,
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    findClaude: async () => {
      // Remember a hit; keep looking when missing (the person may install it meanwhile).
      claudePath ??= await findClaude();
      return claudePath;
    },
    pathExists: async (p) => {
      try {
        return (await stat(p)).isDirectory();
      } catch {
        return false;
      }
    },
    openExternal: async (u) => vscode.env.openExternal(vscode.Uri.parse(u, true)),
    createTerminal: (spec) => {
      vscode.window
        .createTerminal({
          name: spec.name,
          shellPath: spec.shellPath,
          shellArgs: spec.shellArgs,
          cwd: spec.cwd,
          iconPath: icon(),
          location: terminalLocation(),
        })
        .show();
    },
    openIn: () => orbitPrefs().openChatsIn,
    copy: async (t) => vscode.env.clipboard.writeText(t),
    ask: async (message, ...actions) => vscode.window.showInformationMessage(message, ...actions),
    info: (m) => void vscode.window.showInformationMessage(m),
  };
}

/** Runs `claude <args>` (e.g. `mcp login github`) as a terminal's own program — no shell. */
export async function runClaudeInTerminal(args: string[], cwd?: string): Promise<void> {
  const claude = await findClaude();
  if (!claude) {
    void vscode.window.showWarningMessage(
      "The claude command wasn't found. Install Claude Code's CLI to do this from Orbit.",
    );
    return;
  }
  vscode.window
    .createTerminal({
      name: `Claude · ${args.slice(0, 2).join(" ")}`,
      shellPath: claude,
      shellArgs: args,
      cwd,
      iconPath: new vscode.ThemeIcon(args[0] === "auth" ? "account" : "plug"),
    })
    .show();
}
