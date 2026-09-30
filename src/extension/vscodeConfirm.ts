import * as path from "node:path";
import * as vscode from "vscode";
import type { ConfirmHost } from "../core/applyEdit";
import type { EditPlan } from "../core/safeWriter";
import type { ReadOnlyDocs } from "./vscodeDocs";

/** The VS Code prompts around every Orbit edit: modal question, diff preview, Undo notice. */
export function vscodeConfirmHost(previews: ReadOnlyDocs): ConfirmHost {
  return {
    confirm: async (summary, warning) => {
      const backup = "Orbit keeps a backup, and you can undo this afterwards.";
      const show = warning
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;
      const pick = await show(
        summary,
        { modal: true, detail: warning ? `${warning}\n\n${backup}` : backup },
        "Apply",
        "Show changes",
      );
      if (pick === "Apply") return "apply";
      if (pick === "Show changes") return "diff";
      return "cancel";
    },
    showDiff: async (plan: EditPlan) => {
      const name = path.basename(plan.file);
      // The exact text Orbit planned from (the file on disk could differ by now).
      const before =
        plan.before === null
          ? previews.add("", `${name} (new)`)
          : previews.add(plan.before, `${name} (now)`);
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
