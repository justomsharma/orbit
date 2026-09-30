import * as vscode from "vscode";
import { claudeHome } from "../core/paths";
import { readLiveSessions } from "../features/chats/live";
import { ChatsService, type ChatsSnapshot } from "./chatsService";
import { Opener } from "./opener";
import { OrbitState } from "./state";
import { OrbitViewProvider, VIEW_ID } from "./view";
import { vscodeOpenerHost } from "./vscodeHost";

/** What `activate` returns — used by the integration tests. */
export interface OrbitApi {
  refresh(): Promise<void>;
  lastSnapshot(): ChatsSnapshot | null;
}

const DEBOUNCE_MS = 600;
const POLL_MS = 20_000;

export function activate(context: vscode.ExtensionContext): OrbitApi {
  const home = claudeHome();
  const log = vscode.window.createOutputChannel("Orbit", { log: true });
  const state = new OrbitState(context.globalState);
  const chats = new ChatsService(home);
  const opener = new Opener(vscodeOpenerHost());

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "orbit.open";
  const showStatus = (running: number) => {
    status.text = running > 0 ? `$(pulse) ${running} running` : "$(comment-discussion) Orbit";
    status.tooltip =
      running > 0
        ? `${running} Claude chat${running === 1 ? " is" : "s are"} running. Open Orbit`
        : "Open Orbit";
    status.show();
  };
  showStatus(0);

  const provider = new OrbitViewProvider({
    extensionUri: context.extensionUri,
    chats,
    state,
    opener,
    log,
    onSnapshot: (s) => showStatus(s.live.length),
  });

  // Refresh when Claude writes its files, debounced; while hidden only the status bar updates.
  let timer: NodeJS.Timeout | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (provider.visible) void provider.refresh();
      else
        void readLiveSessions(home).then(
          (m) => showStatus(m.size),
          () => {},
        );
    }, DEBOUNCE_MS);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.Uri.file(home),
      "{projects/*/*.jsonl,sessions/*.json,history.jsonl}",
    ),
  );
  watcher.onDidChange(changed);
  watcher.onDidCreate(changed);
  watcher.onDidDelete(changed);

  // Safety net for file systems where watching is unreliable.
  const poll = setInterval(changed, POLL_MS);
  changed();

  context.subscriptions.push(
    log,
    status,
    watcher,
    { dispose: () => clearInterval(poll) },
    { dispose: () => clearTimeout(timer) },
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand("orbit.open", () =>
      vscode.commands.executeCommand("workbench.view.extension.orbit"),
    ),
    vscode.commands.registerCommand("orbit.refresh", () => provider.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.refresh()),
  );

  return {
    refresh: async () => {
      // Works even before the view is opened, so tests and commands can read a snapshot.
      await provider.refresh();
    },
    lastSnapshot: () => provider.last,
  };
}

export function deactivate(): void {}
