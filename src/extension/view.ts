import * as vscode from "vscode";
import type { QuotaInstaller } from "../features/usage/quotaInstall";
import type { HostMsg } from "../shared/protocol";
import type { ChatsService, ChatsSnapshot } from "./chatsService";
import { saveRecapImage } from "./exportFile";
import { createHandler } from "./handler";
import { makeNonce, renderHtml } from "./html";
import type { Opener } from "./opener";
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
  /** Signatures of the data the view last received; identical refreshes are not re-sent. */
  private sent = { sessions: "", usage: "" };

  constructor(private readonly d: ViewDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.sent = { sessions: "", usage: "" };
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

    const handle = createHandler({
      getSession: (id) => this.d.chats.get(id),
      opener: this.d.opener,
      state: this.d.state,
      quota: this.d.quota,
      recapMarkdown: () => this.lastUsage?.recapMarkdown ?? null,
      copy: async (t) => vscode.env.clipboard.writeText(t),
      saveImage: saveRecapImage,
      refresh: () => this.refresh(),
      isKnownLink: (u) => this.d.chats.isKnownLink(u),
      openLink: async (url) => {
        await vscode.env.openExternal(vscode.Uri.parse(url, true));
      },
      info: (m) => void vscode.window.showInformationMessage(m),
      warn: (m) => void vscode.window.showWarningMessage(m),
    });
    w.onDidReceiveMessage((m) =>
      handle(m).catch((e) => this.d.log.error("Action failed", errText(e))),
    );
    view.onDidChangeVisibility(() => {
      this.sent = { sessions: "", usage: "" };
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
    // Usage second: the first full index of a large history can take a few seconds.
    try {
      this.lastUsage = await this.d.usage.snapshot(snap.items, Date.now());
      if (this.view?.visible) this.postOnce("usage", { type: "usage", data: this.lastUsage });
    } catch (e) {
      this.d.log.error("Could not read Claude Code usage", errText(e));
    }
  }

  private postOnce(kind: "sessions" | "usage", m: HostMsg): void {
    const sig = JSON.stringify(m);
    if (sig === this.sent[kind]) return;
    this.sent[kind] = sig;
    this.post(m);
  }

  private post(m: HostMsg): void {
    void this.view?.webview.postMessage(m);
  }
}
