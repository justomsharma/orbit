import * as vscode from "vscode";
import type { LiveStatus } from "../features/chats/types";

/**
 * Which VS Code terminal each running chat is in, so "View" shows it instead of
 * starting the chat a second time. Orbit's own terminals run `claude` as their
 * program, so a terminal's process id is the chat's process id.
 */
export class ChatTerminals implements vscode.Disposable {
  private readonly byId = new Map<string, vscode.Terminal>();
  private readonly pid = new WeakMap<vscode.Terminal, number | undefined>();
  private readonly sub: vscode.Disposable;

  constructor() {
    this.sub = vscode.window.onDidCloseTerminal((t) => {
      for (const [id, x] of this.byId) if (x === t) this.byId.delete(id);
    });
  }

  register(id: string, t: vscode.Terminal): void {
    this.byId.set(id, t);
  }

  /** Links running chats to open terminals by process id. */
  async sync(live: LiveStatus[]): Promise<void> {
    const pids = new Map<number, vscode.Terminal>();
    for (const t of vscode.window.terminals) {
      if (!this.pid.has(t))
        this.pid.set(t, await Promise.resolve(t.processId).catch(() => undefined));
      const p = this.pid.get(t);
      if (p) pids.set(p, t);
    }
    const open = new Set(vscode.window.terminals);
    for (const [id, t] of this.byId) if (!open.has(t)) this.byId.delete(id);
    for (const l of live) {
      const t = pids.get(l.pid);
      if (t) this.byId.set(l.sessionId, t);
    }
  }

  /** Chats whose terminal Orbit can show. */
  linked(): string[] {
    return [...this.byId.keys()];
  }

  show(id: string): boolean {
    const t = this.byId.get(id);
    if (!t) return false;
    t.show(false);
    return true;
  }

  dispose(): void {
    this.sub.dispose();
  }
}

/** Where a new terminal opens: beside, the active column, column 1–3, or with other terminals. */
export function editorColumn(position: string): vscode.ViewColumn {
  // Stack into a column that already holds a terminal, like the editor's own tabs.
  for (const g of vscode.window.tabGroups.all) {
    if (g.tabs.some((t) => t.input instanceof vscode.TabInputTerminal)) return g.viewColumn;
  }
  switch (position) {
    case "active":
      return vscode.ViewColumn.Active;
    case "one":
      return vscode.ViewColumn.One;
    case "two":
      return vscode.ViewColumn.Two;
    case "three":
      return vscode.ViewColumn.Three;
    default:
      return vscode.ViewColumn.Beside;
  }
}
