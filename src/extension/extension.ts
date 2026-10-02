import { randomUUID } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { MiB } from "../core/fsSafe";
import { parseJsonObject } from "../core/json";
import { OrbitStore } from "../core/orbitStore";
import {
  claudeHome,
  claudeJsonPath,
  projectsDir,
  samePath,
  sessionsDir,
  settingsFile,
} from "../core/paths";
import { SafeWriter } from "../core/safeWriter";
import { RefreshScheduler } from "../core/scheduler";
import { Trash } from "../core/trash";
import { Accounts, type SavedAccount } from "../features/account/accounts";
import { credentialStore } from "../features/account/credentials";
import { findClaude } from "../features/chats/findClaude";
import { projectFolderName } from "../features/chats/portable";
import { diagnose, reportMarkdown } from "../features/diagnostics/diagnose";
import { PromptLibrary } from "../features/prompts/library";
import { readJsonFile } from "../features/setup/jsonFile";
import { PausedHooks } from "../features/setup/pausedHooks";
import { redactText } from "../features/setup/redact";
import { findNode } from "../features/usage/findNode";
import { quotaBar } from "../features/usage/quotaBar";
import { QuotaInstaller } from "../features/usage/quotaInstall";
import { ORBIT_LINKS } from "../shared/links";
import { type BrainDeps, exportBrain, importBrain } from "./brainHandler";
import { ChatsService, type ChatsSnapshot } from "./chatsService";
import { saveBytes, saveMarkdown } from "./exportFile";
import { Opener } from "./opener";
import { pathLookup, SetupService } from "./setupService";
import { OrbitState } from "./state";
import { TempChats } from "./tempChats";
import { ChatTerminals } from "./terminals";
import { keepSessionNames } from "./terminalTitles";
import { UsageService, type UsageSnapshot } from "./usageService";
import { OrbitViewProvider, VIEW_ID } from "./view";
import { vscodeConfirmHost } from "./vscodeConfirm";
import { ReadOnlyDocs } from "./vscodeDocs";
import {
  orbitPrefs,
  restoreCount,
  runClaudeInTerminal,
  setTerminalIcon,
  terminalLocation,
  vscodeOpenerHost,
} from "./vscodeHost";

/** What `activate` returns — used by the integration tests. */
export interface OrbitApi {
  refresh(): Promise<void>;
  lastSnapshot(): ChatsSnapshot | null;
  lastUsage(): UsageSnapshot | null;
  /** Runs a webview message through Orbit's handlers (for integration tests). */
  dispatch(m: unknown): Promise<void>;
}

const POLL_MS = 20_000;
const SAVED_ACCOUNTS = "orbit.savedAccounts";
const QUOTA_NUDGE = "orbit.quotaNudgeShown";
const TITLES_BEFORE = "orbit.terminalTitlesBefore";

/** Saves the usage index on shutdown; VS Code waits for the promise deactivate() returns. */
let onExit: (() => Promise<void>) | null = null;

export function activate(context: vscode.ExtensionContext): OrbitApi {
  const home = claudeHome();
  const log = vscode.window.createOutputChannel("Orbit", { log: true });
  const state = new OrbitState(context.globalState);
  const chats = new ChatsService(home);
  setTerminalIcon(vscode.Uri.joinPath(context.extensionUri, "media", "terminal.svg"));
  const terminals = new ChatTerminals();
  const isLive = (id: string): boolean =>
    provider.last?.live.some((l: { sessionId: string }) => l.sessionId === id) ?? false;
  const opener = new Opener(vscodeOpenerHost(terminals, isLive));
  const temp = new TempChats<vscode.Terminal>({
    mark: (set, ids, on) => state.mark(set, ids, on),
    marked: (set) => state.marked(set),
    platform: process.platform,
  });
  let swept = false;

  // Orbit's own files live only in its VS Code storage folder, never in ~/.claude.
  const storage = context.globalStorageUri.fsPath;
  const store = new OrbitStore(storage);
  const writer = new SafeWriter(path.join(storage, "backups"));
  const trash = new Trash(path.join(storage, "trash"));
  const pausedHooks = new PausedHooks(store);
  const brainDeps: BrainDeps = {
    home,
    claudeJson: claudeJsonPath(),
    workspace: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    writer,
    // Read when a command runs; the confirm host is made just below.
    get confirm() {
      return confirm;
    },
    pickScope: async () => {
      const ws = !!vscode.workspace.workspaceFolders?.length;
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: "Yours",
            detail: "CLAUDE.md, settings, skills, commands, agents and MCP servers",
            value: "user" as const,
          },
          ...(ws
            ? [
                {
                  label: "This project's",
                  detail: "CLAUDE.md, .mcp.json and .claude/",
                  value: "project" as const,
                },
                { label: "Both", value: "both" as const },
              ]
            : []),
        ],
        { placeHolder: "What should the backup hold? Keys and tokens are always left out." },
      );
      return pick?.value ?? null;
    },
    pickParts: async (has) => {
      const items = has.map((p) => ({
        label: p === "user" ? "Yours" : "This project's",
        picked: true,
        value: p,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: "Bring in which parts?",
      });
      return picked?.map((x) => x.value) ?? null;
    },
    saveZip: (name, bytes) => saveBytes(name, { "Claude brain backup": ["zip"] }, bytes),
    openZip: async () => {
      const uri = (
        await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "Claude brain backup": ["zip"] },
          openLabel: "Bring in",
        })
      )?.[0];
      if (!uri) return null;
      return Buffer.from(await vscode.workspace.fs.readFile(uri));
    },
    info: (m) => void vscode.window.showInformationMessage(m),
    refresh: () => provider.refresh(),
  };
  const diagnosticsReport = async () => {
    const input = {
      home,
      claudeJson: claudeJsonPath(),
      userHome: os.homedir(),
      workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      platform: process.platform,
      vscodeVersion: vscode.version,
      orbitVersion: String(context.extension.packageJSON.version ?? ""),
      claudeOnPath: () => pathLookup(process.platform)("claude"),
      problems: (provider.lastSetup?.issues ?? []).map((i) => redactText(i.title)),
    };
    return reportMarkdown(await diagnose(input), input);
  };
  const docs = ReadOnlyDocs.register(context);
  const confirm = vscodeConfirmHost(docs);
  const workspace = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  const claudeJson = claudeJsonPath();
  const setup = new SetupService({
    home,
    claudeJson,
    userHome: os.homedir(),
    platform: process.platform,
    pausedHooks: () => pausedHooks.list(),
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

  const accounts = new Accounts({
    claudeJsonPath: claudeJson,
    readClaudeJson: async () =>
      (await readJsonFile(claudeJson, { maxBytes: 64 * MiB, followLinks: true })).data,
    credentials: () => credentialStore(home, process.platform),
    health: async () => {
      let broken = false;
      try {
        const text = await fsp.readFile(claudeJson, "utf8");
        broken = !text.trim() || !parseJsonObject(text);
      } catch {
        broken = false;
      }
      if (!broken) return { broken, backup: null, backupAt: null };
      const dir = path.join(home, "backups");
      const found = (await fsp.readdir(dir).catch(() => [] as string[]))
        .map((n) => ({
          n,
          at: Number(n.match(/^\.claude\.json\.backup\.(\d+)$/)?.[1] ?? Number.NaN),
        }))
        .filter((x) => Number.isFinite(x.at))
        .sort((a, b) => b.at - a.at)[0];
      return found
        ? { broken, backup: path.join(dir, found.n), backupAt: found.at }
        : { broken, backup: null, backupAt: null };
    },
    secrets: context.secrets,
    list: {
      get: () => context.globalState.get<SavedAccount[]>(SAVED_ACCOUNTS, []),
      set: (v) => context.globalState.update(SAVED_ACCOUNTS, v),
    },
    memo: {
      get: (k, d) => context.globalState.get(k, d),
      set: (k, v) => context.globalState.update(k, v),
    },
    writer,
  });

  const provider = new OrbitViewProvider({
    extensionUri: context.extensionUri,
    terminals,
    sessionsDeps: {
      copy: async (t) => vscode.env.clipboard.writeText(t),
      info: (m) => void vscode.window.showInformationMessage(m),
      warn: (m) => void vscode.window.showWarningMessage(m),
      confirm: async (message, detail, action) =>
        (await vscode.window.showInformationMessage(message, { modal: true, detail }, action)) ===
        action,
      saveFile: saveBytes,
      pickFiles: async (many, filters) =>
        (
          (await vscode.window.showOpenDialog({
            canSelectMany: many,
            filters,
            openLabel: "Import",
          })) ?? []
        ).map((u) => u.fsPath),
      readFile: async (p) => {
        try {
          const st = await fsp.lstat(p);
          return st.isFile() && st.size <= 200 * MiB ? await fsp.readFile(p) : null;
        } catch {
          return null;
        }
      },
      pickProject: async (title) => {
        const ws = workspace();
        const seen = new Map<string, string>();
        for (const s of chats.all()) if (s.cwd && !seen.has(s.cwd)) seen.set(s.cwd, s.project);
        const items: (vscode.QuickPickItem & { value: string | null })[] = [
          ...(ws ? [{ label: "$(folder-active) This folder", description: ws, value: ws }] : []),
          ...[...seen]
            .filter(([cwd]) => cwd !== ws)
            .slice(0, 50)
            .map(([cwd, name]) => ({ label: `$(folder) ${name}`, description: cwd, value: cwd })),
          { label: "$(folder-opened) Choose a folder…", value: null },
        ];
        const pick = await vscode.window.showQuickPick(items, { title, matchOnDescription: true });
        if (!pick) return null;
        if (pick.value) return pick.value;
        const dir = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          openLabel: "Import here",
        });
        return dir?.[0]?.fsPath ?? null;
      },
      pathExists: async (p) => {
        try {
          return (await fsp.stat(p)).isDirectory();
        } catch {
          return false;
        }
      },
      projectDir: (cwd) => {
        const same = chats.all().find((s) => s.cwd === cwd);
        return same
          ? path.dirname(same.file)
          : path.join(projectsDir(home), projectFolderName(cwd));
      },
      createFile: async (file, text) => {
        try {
          const plan = await writer.plan(file, (before) => {
            if (before !== null) throw new Error("A chat with this id already exists.");
            return text;
          });
          await writer.apply(plan, "Import chat");
          return true;
        } catch (e) {
          log.warn("Could not import a chat", String(e));
          return false;
        }
      },
      newId: () => randomUUID(),
      resume: (s) => opener.continueInTerminal(s),
      showTerminal: (id) => terminals.show(id),
      startTemp: async () => {
        const cwd = workspace();
        if (!cwd) {
          void vscode.window.showWarningMessage(
            "Open a folder first: a temporary chat is hidden from that folder's list when it ends.",
          );
          return;
        }
        const claude = await findClaude();
        if (!claude) {
          void vscode.window.showWarningMessage(
            "The claude command wasn't found. Install Claude Code's CLI to start a temporary chat.",
          );
          return;
        }
        const t = vscode.window.createTerminal({
          name: "Claude (temp)",
          shellPath: claude,
          shellArgs: [],
          cwd,
          iconPath: new vscode.ThemeIcon("eye-closed"),
          location: terminalLocation(),
        });
        temp.started(
          t,
          cwd,
          chats.all().map((s) => s.id),
        );
        t.show();
      },
      openFolder: async (p, newWindow) => {
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(p), {
          forceNewWindow: newWindow,
        });
      },
      newChat: (prompt) => opener.newChat(prompt),
      restoreCount,
    },
    accounts,
    accountDeps: {
      runClaude: (args) => runClaudeInTerminal(args, workspace() ?? undefined),
      ask: async (message, detail, ...actions) =>
        vscode.window.showInformationMessage(message, { modal: true, detail }, ...actions),
      pick: async (title, items) =>
        (
          await vscode.window.showQuickPick(
            items.map((i) => ({ ...i, label: i.label })),
            { title, placeHolder: "Pick an account", matchOnDetail: true },
          )
        )?.id,
      info: (m) => void vscode.window.showInformationMessage(m),
      warn: (m) => void vscode.window.showWarningMessage(m),
      restoreConfig: async (backup) => {
        try {
          const text = await fsp.readFile(backup, "utf8");
          if (!parseJsonObject(text)) throw new Error("The backup isn't valid JSON either.");
          const plan = await writer.plan(claudeJson, () => text);
          await writer.apply(plan, "Restore ~/.claude.json from Claude's backup");
          return true;
        } catch (e) {
          void vscode.window.showWarningMessage(
            `Couldn't restore ~/.claude.json: ${String(e instanceof Error ? e.message : e)}`,
          );
          return false;
        }
      },
    },
    prefs: () => orbitPrefs(),
    setPref: async (key, value) => {
      const NAMES: Partial<Record<string, string>> = {
        defaultFilter: "chats.defaultFilter",
        defaultProject: "chats.defaultProject",
        restoreCount: "chats.restoreCount",
        keepSessionNames: "terminal.keepSessionNames",
      };
      const name = NAMES[key] ?? key;
      await vscode.workspace
        .getConfiguration("orbit")
        .update(name, value, vscode.ConfigurationTarget.Global);
    },
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
      reveal: async (p) => {
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(p));
      },
      pickFolder: async () => {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: "Let Claude use this folder",
        });
        return picked?.[0]?.fsPath ?? null;
      },
      trash,
      paused: pausedHooks,
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
      openFile: async (file) => {
        await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
      },
      unsaved: (file) =>
        vscode.workspace.textDocuments.some(
          (doc) => doc.isDirty && doc.uri.scheme === "file" && samePath(doc.uri.fsPath, file),
        ),
    },
    log,
    onSnapshot: (s) => {
      showStatus(s.live.length);
      void temp.seen(s.items);
      if (!swept) {
        swept = true;
        void temp.sweep(s.live.map((l) => l.sessionId));
      }
      // Plan limits can be turned on or off from the view.
      limitsSoon();
    },
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
  // Plan limits in the status bar, live: on every statusline render, and each minute
  // so a window that resets shows it even when Claude is quiet.
  const limits = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  limits.command = "orbit.showAccount";
  let limitsTimer: ReturnType<typeof setTimeout> | undefined;
  const showLimits = async () => {
    try {
      const enabled = (await quota.status()).enabled;
      const bar = enabled ? quotaBar(await quota.readQuota(), Date.now()) : null;
      if (!bar) return limits.hide();
      limits.text = bar.text;
      limits.tooltip = bar.tooltip;
      limits.backgroundColor =
        bar.level === "normal"
          ? undefined
          : new vscode.ThemeColor(
              bar.level === "error"
                ? "statusBarItem.errorBackground"
                : "statusBarItem.warningBackground",
            );
      limits.show();
    } catch (e) {
      log.warn("Could not show plan limits in the status bar", String(e));
    }
  };
  const limitsSoon = () => {
    clearTimeout(limitsTimer);
    limitsTimer = setTimeout(() => void showLimits(), 150);
  };
  const limitsWatch = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(path.join(storage, "statusline")), "quota.json"),
  );
  limitsWatch.onDidChange(limitsSoon);
  limitsWatch.onDidCreate(limitsSoon);
  limitsWatch.onDidDelete(limitsSoon);
  const limitsPoll = setInterval(() => void showLimits(), 60_000);
  void showLimits();

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
    limits,
    limitsWatch,
    {
      dispose: () => {
        clearInterval(limitsPoll);
        clearTimeout(limitsTimer);
      },
    },
    scheduler,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand("orbit.open", () =>
      vscode.commands.executeCommand("workbench.view.extension.orbit"),
    ),
    vscode.commands.registerCommand("orbit.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("orbit.tour", openTour),
    vscode.commands.registerCommand("orbit.exportBrain", () => exportBrain(brainDeps)),
    vscode.commands.registerCommand("orbit.importBrain", () => importBrain(brainDeps)),
    vscode.commands.registerCommand("orbit.runDiagnostics", async () => {
      await docs.showMarkdown(await diagnosticsReport(), "Orbit diagnostics");
    }),
    vscode.commands.registerCommand("orbit.reportProblem", async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: "$(copy) Copy a health report", id: "copy" },
          { label: "$(github) Open an issue on GitHub", id: "issue" },
          { label: "$(preview) Open the health report", id: "doc" },
          { label: "$(output) Show Orbit's log", id: "log" },
        ],
        { placeHolder: "Reports have no email, folder names or tokens" },
      );
      if (!pick) return;
      if (pick.id === "log") return log.show();
      const md = await diagnosticsReport();
      if (pick.id === "copy") {
        await vscode.env.clipboard.writeText(md);
        void vscode.window.showInformationMessage("Health report copied.");
      } else if (pick.id === "doc") await docs.showMarkdown(md, "Orbit diagnostics");
      else {
        const body = encodeURIComponent(
          `**What happened**\n\n\n**What I expected**\n\n\n${md}`,
        ).slice(0, 6000);
        await vscode.env.openExternal(
          vscode.Uri.parse(
            `${ORBIT_LINKS.issue}?title=${encodeURIComponent("Problem: ")}&body=${body}`,
            true,
          ),
        );
      }
    }),
    vscode.commands.registerCommand("orbit.switchAccount", () =>
      provider.dispatch({ type: "account:pick" }),
    ),
    // Open Orbit on a tab: Command Palette and the Get started walkthrough.
    ...(
      [
        ["orbit.showChats", "chats"],
        ["orbit.showPrompts", "prompts"],
        ["orbit.showUsage", "usage"],
        ["orbit.showSetup", "config"],
        ["orbit.showAccount", "account"],
        ["orbit.showCheckpoints", "checkpoints"],
      ] as const
    ).map(([id, tab]) =>
      vscode.commands.registerCommand(id, async () => {
        await vscode.commands.executeCommand("workbench.view.extension.orbit");
        provider.goto(tab);
      }),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.refresh()),
    // Logging in or out happens in a terminal: show the new account when it closes.
    // A temporary chat's terminal closing hides its chat.
    vscode.window.onDidCloseTerminal(async (t) => {
      await temp.closed(t);
      void provider.refresh();
    }),
    terminals,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("orbit.terminal.keepSessionNames")) void applyTitles();
      if (e.affectsConfiguration("orbit")) void provider.refresh();
    }),
  );

  onExit = () => usage.flush();

  async function applyTitles(): Promise<void> {
    const on = vscode.workspace
      .getConfiguration("orbit")
      .get<boolean>("terminal.keepSessionNames", false);
    const term = vscode.workspace.getConfiguration();
    try {
      await keepSessionNames(on, {
        get: (k) => term.inspect(k)?.globalValue,
        set: async (k, v) => {
          await term.update(k, v, vscode.ConfigurationTarget.Global);
        },
        saved: () => context.globalState.get<Record<string, unknown> | null>(TITLES_BEFORE, null),
        save: async (v) => {
          await context.globalState.update(TITLES_BEFORE, v);
        },
      });
    } catch (e) {
      log.warn("Could not change terminal tab titles", String(e));
    }
  }

  // Once, for people who use Claude Code: offer plan limits (most don't know they exist).
  const nudge = setTimeout(async () => {
    try {
      if (context.globalState.get<boolean>(QUOTA_NUDGE)) return;
      if ((await quota.status()).enabled || !provider.last?.items.length) return;
      await context.globalState.update(QUOTA_NUDGE, true);
      const pick = await vscode.window.showInformationMessage(
        "Orbit can show your 5-hour and weekly Claude limits in the status bar, and whether they'll last. It reads them on your computer from Claude Code. Turn it on?",
        "Turn on",
        "Not now",
      );
      if (pick === "Turn on") await provider.dispatch({ type: "quota", on: true });
    } catch (e) {
      log.warn("Could not offer plan limits", String(e));
    }
  }, 8000);
  context.subscriptions.push({ dispose: () => clearTimeout(nudge) });

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
