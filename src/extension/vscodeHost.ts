import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import * as vscode from "vscode";
import { currentBranch } from "../features/chats/branch";
import { findClaude } from "../features/chats/findClaude";
import { CLAUDE_EXTENSION_ID } from "../features/chats/handoff";
import {
  DATE_FILTERS,
  EDITOR_POSITIONS,
  OPEN_CHATS_IN,
  type OrbitPrefs,
  TERMINAL_LOCATIONS,
} from "../shared/protocol";
import { isTab, type Tab } from "../shared/tabs";
import type { OpenerHost } from "./opener";
import { type ChatTerminals, editorColumn } from "./terminals";

/** Orbit's own settings, with safe fallbacks for unknown values. */
export function orbitPrefs(): OrbitPrefs {
  const c = vscode.workspace.getConfiguration("orbit");
  const pick = <T extends string>(all: readonly T[], key: string, fallback: T): T => {
    const v = c.get<string>(key);
    return all.find((x) => x === v) ?? fallback;
  };
  return {
    openChatsIn: pick(OPEN_CHATS_IN, "openChatsIn", "terminal"),
    terminalLocation: pick(TERMINAL_LOCATIONS, "terminalLocation", "editor"),
    editorPosition: pick(EDITOR_POSITIONS, "editorPosition", "beside"),
    defaultFilter: pick(DATE_FILTERS, "chats.defaultFilter", "recent"),
    defaultProject: pick(["current", "all"] as const, "chats.defaultProject", "all"),
    keepSessionNames: c.get<boolean>("terminal.keepSessionNames", false) === true,
    restoreCount: restoreCount(),
    density: c.get<string>("density") === "compact" ? "compact" : "comfortable",
    tabOrder: tabList(c.get<unknown>("tabOrder")),
    hiddenTabs: tabList(c.get<unknown>("hiddenTabs")),
  };
}

/** A list of tab ids from settings, without anything else. */
const tabList = (v: unknown): Tab[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is Tab => isTab(x)))] : [];

/** How many recent chats "Restore recent terminals" opens (1–12). */
export function restoreCount(): number {
  const n = vscode.workspace.getConfiguration("orbit").get<number>("chats.restoreCount", 4);
  return Number.isInteger(n) ? Math.min(12, Math.max(1, n)) : 4;
}

/** Where a new Claude terminal goes: a tab beside the editor, or the bottom panel. */
export function terminalLocation(): vscode.TerminalOptions["location"] {
  const p = orbitPrefs();
  return p.terminalLocation === "panel"
    ? vscode.TerminalLocation.Panel
    : { viewColumn: editorColumn(p.editorPosition ?? "beside"), preserveFocus: false };
}

let terminalIcon: vscode.Uri | undefined;
/** Orbit's Claude mark for terminal tabs (set once from the extension's folder). */
export function setTerminalIcon(uri: vscode.Uri): void {
  terminalIcon = uri;
}
const icon = () => terminalIcon ?? new vscode.ThemeIcon("comment-discussion");

/** The real VS Code implementation of everything the Opener needs. */
export function vscodeOpenerHost(
  terminals?: ChatTerminals,
  isLive: (id: string) => boolean = () => false,
): OpenerHost {
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
      const t = vscode.window.createTerminal({
        name: spec.name,
        shellPath: spec.shellPath,
        shellArgs: spec.shellArgs,
        cwd: spec.cwd,
        iconPath: icon(),
        location: terminalLocation(),
      });
      if (spec.sessionId) terminals?.register(spec.sessionId, t);
      t.show();
    },
    openIn: () => orbitPrefs().openChatsIn,
    running: (id) => (!isLive(id) ? "no" : terminals?.show(id) ? "shown" : "untracked"),
    branchOf: (cwd) => currentBranch(cwd),
    checkout: (cwd, branch) =>
      new Promise((done) => {
        execFile(
          "git",
          ["-C", cwd, "checkout", branch],
          { timeout: 15_000, windowsHide: true },
          (err, _out, errOut) =>
            done(
              err
                ? String(errOut || err.message)
                    .trim()
                    .split("\n")[0]!
                : null,
            ),
        );
      }),
    chooseWhere: async () => {
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: "$(terminal) Terminal",
            detail: "Claude Code's CLI in a VS Code terminal",
            value: "terminal" as const,
          },
          {
            label: "$(comment-discussion) Claude's chat panel",
            detail: "The Claude Code extension's chat",
            value: "claudePanel" as const,
          },
        ],
        { title: "Open this chat in…" },
      );
      return pick?.value;
    },
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
