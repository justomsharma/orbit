import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../core/safeWriter";

/**
 * Where Claude Code keeps its sign-in tokens. Orbit only moves the Claude sign-in
 * between this file and VS Code's encrypted secret storage, never reads tokens for
 * anything else, and never sends them to the view.
 */
export interface CredentialStore {
  readonly kind: "file";
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

/** Tokens Claude Code can use: a JSON object with a Claude sign-in inside. */
export function looksLikeCredentials(text: string | null): text is string {
  if (!text || text.length > 64 * 1024) return false;
  try {
    const o = JSON.parse(text) as { claudeAiOauth?: { accessToken?: unknown } };
    return typeof o?.claudeAiOauth?.accessToken === "string";
  } catch {
    return false;
  }
}

/** `~/.claude/.credentials.json`. A linked file is left alone (read as missing, never written). */
export class FileCredentials implements CredentialStore {
  readonly kind = "file";
  constructor(private readonly path: string) {}

  async read(): Promise<string | null> {
    try {
      if (!(await lstat(this.path)).isFile()) return null;
      return await readFile(this.path, "utf8");
    } catch {
      return null;
    }
  }

  async write(text: string): Promise<void> {
    if (!looksLikeCredentials(text)) throw new Error("These aren't Claude Code sign-in details.");
    try {
      if (!(await lstat(this.path)).isFile())
        throw new Error("Claude Code's credentials file is a link, so Orbit won't replace it.");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    // Only the person may read it, as Claude Code itself does.
    await writeFileAtomic(this.path, text, { mode: 0o600 });
  }
}

/**
 * The store Orbit can switch accounts with, or null. On macOS Claude Code keeps
 * its sign-in in the Keychain (a leftover file there isn't what Claude reads),
 * so Orbit doesn't switch accounts on macOS; logging in and out still works.
 */
export async function credentialStore(
  claudeHome: string,
  platform: NodeJS.Platform,
): Promise<CredentialStore | null> {
  if (platform === "darwin") return null;
  return new FileCredentials(join(claudeHome, ".credentials.json"));
}
