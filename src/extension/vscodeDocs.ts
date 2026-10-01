import * as vscode from "vscode";

const SCHEME = "orbit-view";
const MAX_DOCS = 100;

/**
 * Read-only documents Orbit shows in VS Code's own editors: the "after" side of
 * an edit preview, an old version of a file, a chat transcript. Nothing here is
 * ever saved to disk.
 */
export class ReadOnlyDocs implements vscode.TextDocumentContentProvider {
  private readonly docs = new Map<string, string>();
  private next = 0;

  static register(context: vscode.ExtensionContext): ReadOnlyDocs {
    const docs = new ReadOnlyDocs();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, docs));
    return docs;
  }

  /** `name` is shown as the tab title; its extension picks the language. */
  add(text: string, name: string): vscode.Uri {
    const id = String(++this.next);
    this.docs.set(id, text);
    // Keep a bounded number around, but never one that is still open in an editor.
    if (this.docs.size > MAX_DOCS) {
      const open = new Set(
        vscode.workspace.textDocuments
          .filter((d) => d.uri.scheme === SCHEME)
          .map((d) => d.uri.query),
      );
      const oldest = [...this.docs.keys()].find((k) => !open.has(k) && k !== id);
      if (oldest !== undefined) this.docs.delete(oldest);
    }
    const safe = name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "untitled";
    return vscode.Uri.from({ scheme: SCHEME, path: `/${safe}`, query: id });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.query) ?? "";
  }

  /** A chat transcript, rendered by VS Code's Markdown preview. */
  async showMarkdown(text: string, title: string): Promise<void> {
    await vscode.commands.executeCommand("markdown.showPreview", this.add(text, `${title}.md`));
  }

  /** An old version (text) next to the file as it is now (or empty when it is gone). */
  async showDiff(left: string, right: string | null, title: string, name: string): Promise<void> {
    const r = right ? vscode.Uri.file(right) : this.add("", `${name} (deleted)`);
    await vscode.commands.executeCommand("vscode.diff", this.add(left, name), r, title, {
      preview: true,
    });
  }
}
