// Run by VS Code after Orbit is uninstalled (package.json "vscode:uninstall").
// Puts back the person's own statusline so Claude never runs a removed helper.
import * as os from "node:os";
import * as path from "node:path";
import { claudeHome, settingsFile } from "../core/paths";
import { restoreOnUninstall } from "../features/usage/quotaInstall";

restoreOnUninstall(
  settingsFile(claudeHome()),
  path.join(os.tmpdir(), "orbit-uninstall-backup"),
).catch(() => {
  // Nothing more can be done from an uninstall hook; never fail the uninstall.
});
