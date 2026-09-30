import * as vscode from "vscode";
import type { HostMsg } from "../shared/protocol";
import type { ChatsService, ChatsSnapshot } from "./chatsService";
import { createHandler } from "./handler";
import { makeNonce, renderHtml } from "./html";
import type { Opener } from "./opener";
import type { OrbitState } from "./state";

export const VIEW_ID = "orbit.main";

export interface ViewDeps {
  extensionUri: vscode.Uri;
  chats: ChatsService;
  state: OrbitState;
  opener: Opener;
  log: vscode.LogOutputChannel;
  onSnapshot(s: ChatsSnapshot): void;
}

const workspaceFolders = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);

/** The single Orbit sidebar webview. */
export class OrbitViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private running: Promise<void> | null = null;
  private again = false;
  last: ChatsSnapshot | null = null;
  /** Signature of the data the view last received; identical refreshes are not re-sent. */
  private sent = "";

  constructor(private readonly d: ViewDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.sent = "";
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
      refresh: () => this.refresh(),
      isKnownLink: (u) => this.d.chats.isKnownLink(u),
      openLink: async (url) => {
        await vscode.env.openExternal(vscode.Uri.parse(url, true));
      },
      warn: (m) => void vscode.window.showWarningMessage(m),
    });
    w.onDidReceiveMessage((m) =>
      handle(m).catch((e) => this.d.log.error("Action failed", e instanceof Error ? e : String(e))),
    );
    view.onDidChangeVisibility(() => {
      this.sent = "";
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
    try {
      const snap = await this.d.chats.snapshot(workspaceFolders());
      this.last = snap;
      this.d.onSnapshot(snap);
      if (!this.view?.visible) return;
      const msg: HostMsg = {
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
      };
      const sig = JSON.stringify(msg);
      if (sig === this.sent) return;
      this.sent = sig;
      this.post(msg);
    } catch (e) {
      this.d.log.error("Could not read Claude Code data", e instanceof Error ? e : String(e));
      this.post({ type: "error", text: "Orbit couldn't read Claude Code's data folder." });
    }
  }

  private post(m: HostMsg): void {
    void this.view?.webview.postMessage(m);
  }
}
