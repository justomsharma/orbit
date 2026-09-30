import * as vscode from "vscode";
import { claudeHome, projectsDir, sessionsDir } from "../core/paths";
import { RefreshScheduler } from "../core/scheduler";
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

  // Refresh when Claude writes its files: a burst becomes one refresh, and never
  // more than one every 2 s while Claude is writing continuously. The snapshot is
  // cheap (per-file caches, incremental history) and also keeps the status bar right
  // while the sidebar is hidden; the view skips sending data that did not change.
  const scheduler = new RefreshScheduler(() => void provider.refresh(), {
    delayMs: 500,
    minIntervalMs: 2000,
  });
  const changed = () => scheduler.trigger();
  const watch = (base: string, glob: string) => {
    const w = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(base), glob),
    );
    w.onDidChange(changed);
    w.onDidCreate(changed);
    w.onDidDelete(changed);
    return w;
  };
  const watchers = [
    watch(projectsDir(home), "**/*.jsonl"),
    watch(sessionsDir(home), "*.json"),
    watch(home, "history.jsonl"),
  ];

  // Safety net for file systems where watching is unreliable.
  const poll = setInterval(changed, POLL_MS);
  changed();

  context.subscriptions.push(
    log,
    status,
    ...watchers,
    { dispose: () => clearInterval(poll) },
    scheduler,
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
