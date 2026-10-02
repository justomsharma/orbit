import * as vscode from "vscode";
import type { Accounts } from "../features/account/accounts";
import { ConversationCache } from "../features/chats/conversation";
import { settingsCatalog } from "../features/setup/catalog";
import type { MemoryFile } from "../features/setup/memory";
import { checkpointSummaries } from "../features/timeline/summary";
import type { QuotaInstaller } from "../features/usage/quotaInstall";
import type { HostMsg, OrbitPrefs } from "../shared/protocol";
import type { Reading, Tab } from "../shared/tabs";
import { type AccountHandlerDeps, handleAccount } from "./accountHandler";
import { type ChatsHandlerDeps, handleChats } from "./chatsHandler";
import type { ChatsService, ChatsSnapshot } from "./chatsService";
import { saveRecapImage } from "./exportFile";
import { createHandler } from "./handler";
import { makeNonce, renderHtml } from "./html";
import { stepFor } from "./onboarding";
import type { Opener } from "./opener";
import { handleSessions, type SessionsDeps } from "./sessionsHandler";
import { handleSetup, type SetupHandlerDeps } from "./setupHandler";
import { type SetupService, type SetupSnapshot, viewSnapshot } from "./setupService";
import type { OrbitState } from "./state";
import type { UsageService, UsageSnapshot } from "./usageService";

export const VIEW_ID = "orbit.main";

export interface ViewDeps {
  extensionUri: vscode.Uri;
  chats: ChatsService;
  usage: UsageService;
  quota: QuotaInstaller;
  state: OrbitState;
  opener: Opener;
  setup: SetupService;
  /** Everything the Setup actions need except the snapshot, which the view owns. */
  setupDeps: Omit<SetupHandlerDeps, "snapshot" | "refresh" | "post">;
  /** Everything the Chats-tab actions need except posting, which the view owns. */
  chatsDeps: Omit<ChatsHandlerDeps, "post" | "getSession" | "sessions">;
  sessionsDeps: Omit<
    SessionsDeps,
    "getSession" | "sessions" | "live" | "here" | "post" | "refresh" | "state" | "conversations"
  >;
  terminals: { sync(live: ChatsSnapshot["live"]): Promise<void>; linked(): string[] };
  log: vscode.LogOutputChannel;
  onSnapshot(s: ChatsSnapshot): void;
  accounts: Accounts;
  prefs(): OrbitPrefs;
  setPref(key: keyof OrbitPrefs, value: string | number | boolean | string[]): Promise<void>;
  accountDeps: Omit<AccountHandlerDeps, "accounts" | "refresh" | "running">;
  /** Opens the Get started walkthrough. */
  openTour(): Promise<void>;
}

const workspaceFolders = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
const errText = (e: unknown) => (e instanceof Error ? e : String(e));

/** The single Orbit sidebar webview. */
export class OrbitViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private running: Promise<void> | null = null;
  private again = false;
  last: ChatsSnapshot | null = null;
  lastUsage: UsageSnapshot | null = null;
  /** Host copy with real values, for Setup actions. Post only `viewSnapshot(lastSetup)`. */
  lastSetup: SetupSnapshot | null = null;
  /** Another project's memories the view asked for (Memory's project picker). */
  private readonly otherMemory: { files: MemoryFile[] } = { files: [] };
  /** The tab the person is looking at; only its data is read (chats always, for the status bar). */
  private tab: Reading = "home";
  /** Signatures of the data the view last received; identical refreshes are not re-sent. */
  private sent = {
    sessions: "",
    usage: "",
    setup: "",
    catalog: "",
    prompts: "",
    account: "",
    checkpoints: "",
  };
  /** A tab asked for before the view was ready; sent when it says "ready". */
  private pendingGoto: Tab | null = null;
  private remembered = 0;
  private readonly conversations = new ConversationCache();

  /**
   * Runs one message from the webview (every message is validated inside the
   * handlers). Also the test API's way in, so integration tests exercise the
   * same code paths as a click.
   */
  readonly dispatch: (m: unknown) => Promise<void>;

  constructor(private readonly d: ViewDeps) {
    const handle = createHandler({
      getSession: (id) => this.d.chats.get(id),
      opener: this.d.opener,
      state: this.d.state,
      quota: this.d.quota,
      recapMarkdown: () => this.lastUsage?.recapMarkdown ?? null,
      copy: async (t) => vscode.env.clipboard.writeText(t),
      saveImage: saveRecapImage,
      refresh: () => this.refresh(),
      setPref: (k, v) => this.d.setPref(k, v),
      continueLast: () => this.d.opener.continueLast(),
      setTab: (t) => {
        this.tab = t;
      },
      // PR links from chats, and the PR Claude's statusline reported.
      isKnownLink: (u) => this.d.chats.isKnownLink(u) || this.lastUsage?.quota.data?.pr?.url === u,
      openLink: async (url) => {
        await vscode.env.openExternal(vscode.Uri.parse(url, true));
      },
      logError: (m) => this.d.log.error(m),
      orbitCommand: async (id) => {
        await vscode.commands.executeCommand(`orbit.${id}`);
      },
      openOrbitSettings: async () => {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:OmSharma.orbit-hq",
        );
      },
      info: (m) => void vscode.window.showInformationMessage(m),
      warn: (m) => void vscode.window.showWarningMessage(m),
    });
    const setupDeps: SetupHandlerDeps = {
      ...this.d.setupDeps,
      snapshot: () => this.lastSetup,
      refresh: () => this.refresh(),
      reply: (req, ok) => this.post({ type: "setup:result", req, ok }),
      post: (m) => this.post(m),
      otherMemory: this.otherMemory,
    };
    const chatsDeps: ChatsHandlerDeps = {
      ...this.d.chatsDeps,
      getSession: (id) => this.d.chats.get(id),
      sessions: () => this.d.chats.all(),
      post: (msg) => this.post(msg),
    };
    const sessionsDeps: SessionsDeps = {
      ...this.d.sessionsDeps,
      getSession: (id) => this.d.chats.get(id),
      sessions: () => this.d.chats.all(),
      live: () => this.last?.live ?? [],
      here: () => this.last?.here ?? [],
      post: (msg) => this.post(msg),
      refresh: () => this.refresh(),
      state: this.d.state,
      conversations: this.conversations,
    };
    const accountDeps: AccountHandlerDeps = {
      ...this.d.accountDeps,
      accounts: this.d.accounts,
      running: () => this.last?.live.length ?? 0,
      refresh: () => this.refresh(),
    };
    this.dispatch = async (m) => {
      try {
        if (
          !(await handleSetup(m, setupDeps)) &&
          !(await handleSessions(m, sessionsDeps)) &&
          !(await handleChats(m, chatsDeps)) &&
          !(await handleAccount(m, accountDeps))
        )
          await handle(m);
        await this.track(m);
      } catch (e) {
        this.d.log.error("Action failed", errText(e));
      }
    };
  }

  /** Ticks the Get started checklist when a person does one of its steps. */
  private async track(m: unknown): Promise<void> {
    const msg = m as { type?: unknown; action?: unknown };
    if (msg?.type === "ready" && this.pendingGoto) {
      this.post({ type: "goto", tab: this.pendingGoto });
      this.pendingGoto = null;
    }
    if (msg?.type === "onboarding" && msg.action === "tour") return this.d.openTour();
    if (msg?.type === "onboarding" && msg.action === "welcomed") {
      await this.d.state.markWelcomed();
      return void this.refresh();
    }
    if (msg?.type === "onboarding" && msg.action === "dismiss") {
      await this.d.state.dismissOnboarding();
      return void this.refresh();
    }
    const step = stepFor(m);
    if (step && (await this.d.state.markStep(step))) void this.refresh();
  }

  /** Opens a tab in the sidebar (Get started walkthrough, commands). */
  goto(tab: Tab): void {
    if (this.view) this.post({ type: "goto", tab });
    else this.pendingGoto = tab;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.sent = {
      sessions: "",
      usage: "",
      setup: "",
      catalog: "",
      prompts: "",
      account: "",
      checkpoints: "",
    };
    const root = vscode.Uri.joinPath(this.d.extensionUri, "dist", "webview");
    const w = view.webview;
    w.options = { enableScripts: true, enableForms: false, localResourceRoots: [root] };
    const asset = (f: string) => w.asWebviewUri(vscode.Uri.joinPath(root, f)).toString();
    w.html = renderHtml({
      cspSource: w.cspSource,
      nonce: makeNonce(),
      scriptUri: asset("main.js"),
      styleUri: asset("main.css"),
      codiconUri: asset("codicon.css"),
    });

    w.onDidReceiveMessage((m) => this.dispatch(m));
    view.onDidChangeVisibility(() => {
      this.sent = {
        sessions: "",
        usage: "",
        setup: "",
        catalog: "",
        prompts: "",
        account: "",
        checkpoints: "",
      };
      if (view.visible) void this.refresh();
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  /** Re-reads Claude's data and pushes it to the view. Concurrent calls coalesce into one follow-up run. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.push();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async push(): Promise<void> {
    let snap: ChatsSnapshot;
    try {
      snap = await this.d.chats.snapshot(workspaceFolders());
    } catch (e) {
      this.d.log.error("Could not read Claude Code chats", errText(e));
      this.post({ type: "error", text: "Orbit couldn't read Claude Code's data folder." });
      return;
    }
    this.last = snap;
    await this.d.terminals.sync(snap.live).catch(() => {});
    this.d.onSnapshot(snap);
    if (this.view?.visible) {
      this.postOnce("sessions", {
        type: "sessions",
        items: snap.items,
        live: snap.live,
        pins: this.d.state.pins(),
        renames: this.d.state.renames(),
        tags: this.d.state.tags(),
        onboarding: this.d.state.onboarding(),
        here: snap.here,
        archived: this.d.state.marked("archived"),
        hidden: this.d.state.marked("hidden"),
        temp: this.d.state.marked("temp"),
        terminals: this.d.terminals.linked(),
        env: {
          claudeExtension: this.d.opener.claudeExtensionInstalled(),
          hasWorkspace: workspaceFolders().length > 0,
          platform: process.platform,
          prefs: this.d.prefs(),
        },
      });
    }
    // The rest only while the sidebar is visible; it refreshes as soon as it is shown again.
    if (!this.view?.visible) return;
    if (this.tab === "prompts") {
      try {
        const items = await this.d.chatsDeps.prompts.update();
        // Any new or repeated prompt changes the newest entry or the total count.
        const uses = items.reduce((n, p) => n + p.count, 0);
        const sig = `${items.length}:${uses}:${items[0]?.id ?? ""}:${items[0]?.last ?? 0}`;
        this.postOnce("prompts", { type: "prompts", items }, sig);
      } catch (e) {
        this.d.log.error("Could not read Claude Code prompt history", errText(e));
        this.postOnce("prompts", {
          type: "prompts",
          items: [],
          error: "Orbit couldn't read Claude Code's prompt history.",
        });
      }
      return;
    }
    if (this.tab === "setup") {
      try {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
        this.lastSetup = await this.d.setup.snapshot(ws);
        this.postOnce("catalog", { type: "catalog", data: settingsCatalog() });
        // The host keeps the real values for actions; the view gets tokens hidden.
        this.postOnce("setup", { type: "setup", data: viewSnapshot(this.lastSetup) });
      } catch (e) {
        this.d.log.error("Could not read Claude Code setup", errText(e));
      }
      return;
    }
    if (this.tab === "checkpoints") {
      try {
        const items = await checkpointSummaries(this.d.chatsDeps.home);
        this.postOnce("checkpoints", { type: "checkpoints", items });
      } catch (e) {
        this.d.log.error("Could not read Claude Code checkpoints", errText(e));
      }
      return;
    }
    if (this.tab === "account") {
      try {
        this.postOnce("account", { type: "account", data: await this.d.accounts.snapshot() });
      } catch (e) {
        this.d.log.error("Could not read the Claude Code account", errText(e));
      }
      // Plan limits on Account come from the usage snapshot below.
    }
    // Usage (Home, Usage and Account tabs): the first full index of a large history can take a few seconds.
    try {
      this.lastUsage = await this.d.usage.snapshot(snap.items, Date.now());
      // Plan limits already on counts as that getting-started step.
      if (this.lastUsage.quota.enabled && (await this.d.state.markStep("limits")))
        this.again = true;
      if (this.view?.visible) this.postOnce("usage", { type: "usage", data: this.lastUsage });
      // Keep each account's latest limits, to show after switching away from it.
      const q = this.lastUsage.quota.data;
      if (q && q.updatedAt !== this.remembered) {
        this.remembered = q.updatedAt;
        void this.d.accounts.remember(q).catch(() => {});
      }
    } catch (e) {
      this.d.log.error("Could not read Claude Code usage", errText(e));
    }
  }

  /** `sig` replaces the full JSON comparison for big payloads (the prompt list). */
  private postOnce(
    kind: keyof OrbitViewProvider["sent"],
    m: HostMsg,
    sig = JSON.stringify(m),
  ): void {
    if (sig === this.sent[kind]) return;
    this.sent[kind] = sig;
    this.post(m);
  }

  private post(m: HostMsg): void {
    void this.view?.webview.postMessage(m);
  }
}
