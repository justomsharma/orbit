import { join } from "node:path";
import { settingsFile } from "../../core/paths";
import { readJsonFile, SETTINGS_MAX, type Skipped } from "./jsonFile";

export type SettingsScope = "user" | "project" | "local" | "managed";

/** One settings file. `data` is the raw object — host side only (it holds `env` values). */
export interface SettingsFile {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  data: Record<string, unknown> | null;
  /** The JSON is broken (see `JsonFile`). */
  error: string | null;
  /** Orbit left it unread; Claude Code may still use it. */
  skipped: Skipped | null;
}

/** Highest precedence first: managed > local > project > user. */
export const PRECEDENCE: readonly SettingsScope[] = ["managed", "local", "project", "user"];

/** Admin-managed settings; Orbit only ever reads this file. */
export function managedSettingsPath(platform: NodeJS.Platform): string {
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  return "/etc/claude-code/managed-settings.json";
}

/** Follows links: Claude Code does, and dotfile managers link settings files. */
export async function readSettingsFile(scope: SettingsScope, path: string): Promise<SettingsFile> {
  const f = await readJsonFile(path, { maxBytes: SETTINGS_MAX, followLinks: true });
  return { scope, path, exists: f.exists, data: f.data, error: f.error, skipped: f.skipped };
}

/**
 * Settings files in order user, project, local, managed. `home` is Claude's
 * data folder (`~/.claude`); project and local only when a folder is open.
 */
export async function readSettingsFiles(
  home: string,
  workspace: string | null,
  platform: NodeJS.Platform = process.platform,
): Promise<SettingsFile[]> {
  const files: [SettingsScope, string][] = [["user", settingsFile(home)]];
  if (workspace) {
    files.push(["project", join(workspace, ".claude", "settings.json")]);
    files.push(["local", join(workspace, ".claude", "settings.local.json")]);
  }
  files.push(["managed", managedSettingsPath(platform)]);
  return Promise.all(files.map(([scope, p]) => readSettingsFile(scope, p)));
}

/** Files that parsed, highest precedence first. */
export function byPrecedence(settings: SettingsFile[]): SettingsFile[] {
  return settings
    .filter((s) => s.data)
    .sort((a, b) => PRECEDENCE.indexOf(a.scope) - PRECEDENCE.indexOf(b.scope));
}
