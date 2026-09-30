import * as path from "node:path";
import * as vscode from "vscode";
import type { ConfirmHost } from "../core/applyEdit";
import type { EditPlan } from "../core/safeWriter";

const SCHEME = "orbit-preview";

/** Serves the "after" text of pending edits so VS Code's diff editor can show them. */
class PreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly docs = new Map<string, string>();
  private next = 0;

  add(text: string, name: string): vscode.Uri {
    const id = String(++this.next);
    this.docs.set(id, text);
    // Keep only a handful of previews around.
    if (this.docs.size > 20) this.docs.delete(this.docs.keys().next().value!);
    return vscode.Uri.from({ scheme: SCHEME, path: `/${name}`, query: id });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.query) ?? "";
  }
}

/** The VS Code prompts around every Orbit edit: modal question, diff preview, Undo notice. */
export function vscodeConfirmHost(context: vscode.ExtensionContext): ConfirmHost {
  const previews = new PreviewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, previews),
  );

  return {
    confirm: async (summary) => {
      const pick = await vscode.window.showInformationMessage(
        summary,
        { modal: true, detail: "Orbit keeps a backup, and you can undo this afterwards." },
        "Apply",
        "Show changes",
      );
      if (pick === "Apply") return "apply";
      if (pick === "Show changes") return "diff";
      return "cancel";
    },
    showDiff: async (plan: EditPlan) => {
      const name = path.basename(plan.file);
      const before =
        plan.before === null ? previews.add("", `${name} (new)`) : vscode.Uri.file(plan.file);
      const after = previews.add(plan.after, name);
      await vscode.commands.executeCommand(
        "vscode.diff",
        before,
        after,
        `${name}: Orbit's change`,
        {
          preview: true,
        },
      );
    },
    done: async (label, undo) => {
      const pick = await vscode.window.showInformationMessage(`Done: ${label}.`, "Undo");
      // A failed undo has already said why, so "Undone" only shows when it worked.
      if (pick === "Undo" && (await undo()))
        void vscode.window.showInformationMessage(`Undone: ${label}.`);
    },
    warn: (m) => void vscode.window.showWarningMessage(m),
  };
}
