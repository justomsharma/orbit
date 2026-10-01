import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { OrbitStore } from "../core/orbitStore";
import { claudeHome, claudeJsonPath, projectsDir, sessionsDir, settingsFile } from "../core/paths";
import { SafeWriter } from "../core/safeWriter";
import { RefreshScheduler } from "../core/scheduler";
import { PromptLibrary } from "../features/prompts/library";
import { findNode } from "../features/usage/findNode";
import { QuotaInstaller } from "../features/usage/quotaInstall";
import { ChatsService, type ChatsSnapshot } from "./chatsService";
import { saveMarkdown } from "./exportFile";
import { Opener } from "./opener";
import { SetupService } from "./setupService";
import { OrbitState } from "./state";
import { UsageService, type UsageSnapshot } from "./usageService";
import { OrbitViewProvider, VIEW_ID } from "./view";
import { vscodeConfirmHost } from "./vscodeConfirm";
import { ReadOnlyDocs } from "./vscodeDocs";
import { runClaudeInTerminal, vscodeOpenerHost } from "./vscodeHost";

/** What `activate` returns — used by the integration tests. */
export interface OrbitApi {
  refresh(): Promise<void>;
  lastSnapshot(): ChatsSnapshot | null;
  lastUsage(): UsageSnapshot | null;
  /** Runs a webview message through Orbit's handlers (for integration tests). */
  dispatch(m: unknown): Promise<void>;
}

const POLL_MS = 20_000;
const TOUR_SHOWN = "orbit.tourShown";

/** Saves the usage index on shutdown; VS Code waits for the promise deactivate() returns. */
let onExit: (() => Promise<void>) | null = null;

export function activate(context: vscode.ExtensionContext): OrbitApi {
  const home = claudeHome();
  const log = vscode.window.createOutputChannel("Orbit", { log: true });
  const state = new OrbitState(context.globalState);
  const chats = new ChatsService(home);
  const opener = new Opener(vscodeOpenerHost());

  // Orbit's own files live only in its VS Code storage folder, never in ~/.claude.
  const storage = context.globalStorageUri.fsPath;
  const store = new OrbitStore(storage);
  const writer = new SafeWriter(path.join(storage, "backups"));
  const docs = ReadOnlyDocs.register(context);
  const confirm = vscodeConfirmHost(docs);
  const workspace = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  const claudeJson = claudeJsonPath();
  const setup = new SetupService({
    home,
    claudeJson,
    userHome: os.homedir(),
    platform: process.platform,
  });
  const quota = new QuotaInstaller({
    settingsPath: settingsFile(home),
    tapDir: path.join(storage, "statusline"),
    tapSource: vscode.Uri.joinPath(context.extensionUri, "dist", "statusline-tap.js").fsPath,
    store,
    writer,
    findNode: () => findNode(),
    platform: process.platform,
    confirm,
    workspace,
  });
  const usage = new UsageService(home, store, quota);
  void quota.syncTap().catch((e) => log.warn("Could not refresh the statusline tap", String(e)));

  const tour = `${context.extension.id}#orbit.getStarted`;
  async function openTour(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.openWalkthrough", tour, false);
  }

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
    usage,
    quota,
    state,
    opener,
    setup,
    setupDeps: {
      home,
      claudeJson,
      workspace,
      platform: process.platform,
      writer,
      confirm,
      openFile: async (file) => {
        await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
      },
      runClaude: (args, cwd) => runClaudeInTerminal(args, cwd),
      newChat: (prompt) => opener.newChat(prompt),
    },
    chatsDeps: {
      home,
      prompts: new PromptLibrary(home),
      writer,
      confirm,
      newChat: (prompt) => opener.newChat(prompt),
      copy: async (t) => vscode.env.clipboard.writeText(t),
      info: (m) => void vscode.window.showInformationMessage(m),
      showDiff: (left, right, title, name) => docs.showDiff(left, right, title, name),
      showMarkdown: (text, title) => docs.showMarkdown(text, title),
      saveMarkdown,
    },
    log,
    onSnapshot: (s) => showStatus(s.live.length),
    openTour,
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
    // The tap rewrites quota.json on every statusline render.
    watch(path.join(storage, "statusline"), "quota.json"),
    // Setup: settings, skills, agents, commands, plugins, MCP and project instructions.
    watch(
      home,
      "{settings.json,CLAUDE.md,skills/**,agents/**,commands/**,plugins/installed_plugins.json}",
    ),
    watch(os.homedir(), ".claude.json"),
  ];
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const w = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(f, "{.claude/**,.mcp.json,CLAUDE.md,CLAUDE.local.md}"),
    );
    w.onDidChange(changed);
    w.onDidCreate(changed);
    w.onDidDelete(changed);
    watchers.push(w);
  }

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
    vscode.commands.registerCommand("orbit.tour", openTour),
    // Open Orbit on a tab: Command Palette and the Get started walkthrough.
    ...(
      [
        ["orbit.showChats", "chats"],
        ["orbit.showPrompts", "prompts"],
        ["orbit.showUsage", "usage"],
        ["orbit.showSetup", "setup"],
      ] as const
    ).map(([id, tab]) =>
      vscode.commands.registerCommand(id, async () => {
        await vscode.commands.executeCommand("workbench.view.extension.orbit");
        provider.goto(tab);
      }),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.refresh()),
  );

  onExit = () => usage.flush();

  // VS Code only opens a walkthrough on some installs (not from a .vsix, nor on reinstall),
  // so Orbit opens its own tour once, unless the person already hid Get started.
  if (!context.globalState.get<boolean>(TOUR_SHOWN) && !state.onboarding().dismissed) {
    void context.globalState.update(TOUR_SHOWN, true);
    void openTour().catch((e) => log.warn("Could not open the Get started tour", String(e)));
  }

  return {
    refresh: async () => {
      // Works even before the view is opened, so tests and commands can read a snapshot.
      await provider.refresh();
    },
    lastSnapshot: () => provider.last,
    lastUsage: () => provider.lastUsage,
    dispatch: (m: unknown) => provider.dispatch(m),
  };
}

export function deactivate(): Promise<void> | undefined {
  return onExit?.();
}
