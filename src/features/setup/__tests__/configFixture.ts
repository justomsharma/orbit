import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SettingsFile, SettingsScope } from "../settings";

/** Writes `value` (JSON-encoded unless it is already text), creating parent folders. */
export function put(p: string, value: unknown): string {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return p;
}

/** A parsed settings file for the pure readers. */
export function settingsOf(
  scope: SettingsScope,
  data: Record<string, unknown> | null,
  path = join("/cfg", `${scope}.json`),
): SettingsFile {
  return { scope, path, exists: data !== null, data, error: null };
}

/** A plugin folder shaped like one in `~/.claude/plugins/cache/<mkt>/<name>/<version>`. */
export function pluginDir(home: string, name: string, mkt = "official", version = "1.0.0"): string {
  const d = join(home, "plugins", "cache", mkt, name, version);
  mkdirSync(d, { recursive: true });
  return d;
}

export interface InstallRecord {
  scope: string;
  installPath: string;
  version?: string;
  projectPath?: string;
}

/** Writes `~/.claude/plugins/installed_plugins.json` in the current (version 2) shape. */
export function writeInstalled(home: string, plugins: Record<string, InstallRecord[]>): void {
  const withDefaults = Object.fromEntries(
    Object.entries(plugins).map(([id, list]) => [
      id,
      list.map((r) => ({
        version: "1.0.0",
        installedAt: "2026-09-01T10:00:00.000Z",
        lastUpdated: "2026-09-01T10:00:00.000Z",
        gitCommitSha: "0123456789abcdef",
        ...r,
      })),
    ]),
  );
  put(join(home, "plugins", "installed_plugins.json"), { version: 2, plugins: withDefaults });
}
