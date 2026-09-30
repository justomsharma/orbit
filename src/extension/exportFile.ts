import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes a PNG data URL, or null when it is not a real PNG. */
export function pngBytes(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/png;base64,") || comma < 0) return null;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  return bytes.subarray(0, 8).equals(PNG_SIGNATURE) ? bytes : null;
}

/**
 * Saves the recap card to a file the person picks in VS Code's own save dialog
 * (which asks before replacing an existing file). The only place Orbit writes
 * outside its own storage without going through SafeWriter — and only on an
 * explicit click, to a path the person chose.
 */
export async function saveRecapImage(dataUrl: string): Promise<void> {
  const bytes = pngBytes(dataUrl);
  if (!bytes) {
    void vscode.window.showWarningMessage("Orbit couldn't create the recap image.");
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(os.homedir(), "Downloads", `claude-week-${day}.png`)),
    filters: { "PNG image": ["png"] },
    saveLabel: "Save recap",
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, bytes);
  const pick = await vscode.window.showInformationMessage(
    `Saved ${path.basename(uri.fsPath)}.`,
    "Show file",
  );
  if (pick === "Show file") await vscode.commands.executeCommand("revealFileInOS", uri);
}
