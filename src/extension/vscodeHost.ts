import { stat } from "node:fs/promises";
import * as vscode from "vscode";
import { findClaude } from "../features/chats/findClaude";
import { CLAUDE_EXTENSION_ID } from "../features/chats/handoff";
import type { OpenerHost } from "./opener";

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
          iconPath: new vscode.ThemeIcon("comment-discussion"),
        })
        .show();
    },
    copy: async (t) => vscode.env.clipboard.writeText(t),
    ask: async (message, ...actions) => vscode.window.showInformationMessage(message, ...actions),
    info: (m) => void vscode.window.showInformationMessage(m),
  };
}
