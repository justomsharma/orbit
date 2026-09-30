import * as vscode from "vscode";

const SCHEME = "orbit-view";

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
    // Keep only a handful around.
    if (this.docs.size > 20) this.docs.delete(this.docs.keys().next().value!);
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
