import * as vscode from "vscode";
import { settingsCatalog } from "../features/setup/catalog";
import type { QuotaInstaller } from "../features/usage/quotaInstall";
import type { HostMsg } from "../shared/protocol";
import { type ChatsHandlerDeps, handleChats } from "./chatsHandler";
import type { ChatsService, ChatsSnapshot } from "./chatsService";
import { saveRecapImage } from "./exportFile";
import { createHandler } from "./handler";
import { makeNonce, renderHtml } from "./html";
import type { Opener } from "./opener";
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
  setupDeps: Omit<SetupHandlerDeps, "snapshot" | "refresh">;
  /** Everything the Chats-tab actions need except posting, which the view owns. */
  chatsDeps: Omit<ChatsHandlerDeps, "post" | "getSession" | "sessions">;
  log: vscode.LogOutputChannel;
  onSnapshot(s: ChatsSnapshot): void;
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
  /** The tab the person is looking at; only its data is read (chats always, for the status bar). */
  private tab: "home" | "chats" | "prompts" | "usage" | "setup" = "home";
  /** Signatures of the data the view last received; identical refreshes are not re-sent. */
  private sent = { sessions: "", usage: "", setup: "", catalog: "", prompts: "" };

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
      setTab: (t) => {
        this.tab = t;
      },
      isKnownLink: (u) => this.d.chats.isKnownLink(u),
      openLink: async (url) => {
        await vscode.env.openExternal(vscode.Uri.parse(url, true));
      },
      info: (m) => void vscode.window.showInformationMessage(m),
      warn: (m) => void vscode.window.showWarningMessage(m),
    });
    const setupDeps: SetupHandlerDeps = {
      ...this.d.setupDeps,
      snapshot: () => this.lastSetup,
      refresh: () => this.refresh(),
      reply: (req, ok) => this.post({ type: "setup:result", req, ok }),
    };
    const chatsDeps: ChatsHandlerDeps = {
      ...this.d.chatsDeps,
      getSession: (id) => this.d.chats.get(id),
      sessions: () => this.d.chats.all(),
      post: (msg) => this.post(msg),
    };
    this.dispatch = async (m) => {
      try {
        if (!(await handleSetup(m, setupDeps)) && !(await handleChats(m, chatsDeps)))
          await handle(m);
      } catch (e) {
        this.d.log.error("Action failed", errText(e));
      }
    };
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.sent = { sessions: "", usage: "", setup: "", catalog: "", prompts: "" };
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
      this.sent = { sessions: "", usage: "", setup: "", catalog: "", prompts: "" };
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
    this.d.onSnapshot(snap);
    if (this.view?.visible) {
      this.postOnce("sessions", {
        type: "sessions",
        items: snap.items,
        live: snap.live,
        pins: this.d.state.pins(),
        renames: this.d.state.renames(),
        here: snap.here,
        env: {
          claudeExtension: this.d.opener.claudeExtensionInstalled(),
          hasWorkspace: workspaceFolders().length > 0,
          platform: process.platform,
        },
      });
    }
    // The rest only while the sidebar is visible; it refreshes as soon as it is shown again.
    if (!this.view?.visible) return;
    if (this.tab === "prompts") {
      try {
        this.postOnce("prompts", {
          type: "prompts",
          items: await this.d.chatsDeps.prompts.update(),
        });
      } catch (e) {
        this.d.log.error("Could not read Claude Code prompt history", errText(e));
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
    // Usage (Home and Usage tabs): the first full index of a large history can take a few seconds.
    try {
      this.lastUsage = await this.d.usage.snapshot(snap.items, Date.now());
      if (this.view?.visible) this.postOnce("usage", { type: "usage", data: this.lastUsage });
    } catch (e) {
      this.d.log.error("Could not read Claude Code usage", errText(e));
    }
  }

  private postOnce(kind: keyof OrbitViewProvider["sent"], m: HostMsg): void {
    const sig = JSON.stringify(m);
    if (sig === this.sent[kind]) return;
    this.sent[kind] = sig;
    this.post(m);
  }

  private post(m: HostMsg): void {
    void this.view?.webview.postMessage(m);
  }
}
