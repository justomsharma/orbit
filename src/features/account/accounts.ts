import { createHash } from "node:crypto";
import { ConflictError, type EditPlan, type UndoEntry } from "../../core/safeWriter";
import { type CredentialStore, looksLikeCredentials } from "./credentials";
import { identityFrom, type Profile, profileFrom } from "./profile";

/** A saved account as the view sees it (no tokens). */
export interface SavedAccount {
  id: string;
  name: string;
  email: string;
  plan: string | null;
  organization: string | null;
  savedAt: number;
}

export interface AccountSnapshot {
  profile: Profile | null;
  saved: SavedAccount[];
  /** Saved accounts can be switched on this machine. */
  canSwitch: boolean;
}

/** What one saved account keeps in VS Code's encrypted secret storage. */
interface Secret {
  /** Claude Code's `claudeAiOauth` sign-in object, and nothing else from the file. */
  oauth: Record<string, unknown>;
  /** The account part of ~/.claude.json. */
  oauthAccount: Record<string, unknown>;
  /** sha256 of the refresh token, to spot the same sign-in saved under two accounts. */
  fp: string;
}

export interface AccountDeps {
  claudeJsonPath: string;
  readClaudeJson(): Promise<unknown>;
  credentials(): Promise<CredentialStore | null>;
  /** VS Code's SecretStorage (encrypted by the OS). */
  secrets: {
    get(key: string): PromiseLike<string | undefined>;
    store(key: string, value: string): PromiseLike<void>;
    delete(key: string): PromiseLike<void>;
  };
  /** The list of saved accounts (no secrets), e.g. in globalState. */
  list: { get(): SavedAccount[]; set(v: SavedAccount[]): PromiseLike<void> };
  writer: {
    planJson(file: string, mutate: (o: Record<string, unknown>) => void): Promise<EditPlan>;
    apply(plan: EditPlan, label: string): Promise<UndoEntry>;
    undo(id: string): Promise<void>;
  };
}

export const MAX_SAVED = 12;
const KEY = (id: string) => `orbit.account.${id}`;
/** The sign-in Claude Code had before Orbit's last switch, kept in case anything goes wrong. */
export const BACKUP_KEY = "orbit.account.before-switch";

const oauthOf = (text: string): Record<string, unknown> =>
  (JSON.parse(text) as { claudeAiOauth: Record<string, unknown> }).claudeAiOauth;

function fingerprint(oauth: Record<string, unknown>): string {
  const t = oauth.refreshToken ?? oauth.accessToken;
  return createHash("sha256").update(String(t)).digest("hex");
}

function parseSecret(text: string | undefined): Secret | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Secret;
    return s?.oauth &&
      typeof s.oauth.accessToken === "string" &&
      s.oauthAccount &&
      typeof s.oauthAccount === "object" &&
      typeof s.fp === "string"
      ? s
      : null;
  } catch {
    return null;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Saving, switching and forgetting Claude Code accounts, done safely. */
export class Accounts {
  constructor(private readonly d: AccountDeps) {}

  private saved(): SavedAccount[] {
    const v = this.d.list.get();
    return Array.isArray(v) ? v.filter((a) => a && typeof a.id === "string") : [];
  }

  async snapshot(): Promise<AccountSnapshot> {
    const profile = profileFrom(await this.d.readClaudeJson());
    return { profile, saved: this.saved(), canSwitch: (await this.d.credentials()) !== null };
  }

  /** Saves (or refreshes) the signed-in account. Returns its name. */
  async saveCurrent(): Promise<string> {
    const json = await this.d.readClaudeJson();
    const profile = profileFrom(json);
    const identity = identityFrom(json);
    if (!profile || !identity) throw new Error("Claude Code isn't signed in to a Claude account.");
    const store = await this.d.credentials();
    if (!store) throw new Error("Orbit can't save Claude Code accounts on this computer.");
    const text = await store.read();
    if (!looksLikeCredentials(text))
      throw new Error("Orbit can't read Claude Code's sign-in. Log in again, then save.");
    const oauth = oauthOf(text);
    const fp = fingerprint(oauth);
    const others = this.saved().filter((a) => a.id !== profile.id);
    // The same tokens saved as someone else means ~/.claude.json and the sign-in disagree
    // (a running chat wrote its old account back): saving would mix two accounts up.
    for (const a of others) {
      if (parseSecret(await this.d.secrets.get(KEY(a.id)))?.fp === fp)
        throw new Error(
          `Claude Code's sign-in belongs to ${a.email}, but it says ${profile.email}. Log in again, then save.`,
        );
    }
    if (others.length >= MAX_SAVED)
      throw new Error(`You can save up to ${MAX_SAVED} accounts. Remove one first.`);
    const secret: Secret = { oauth, oauthAccount: identity.oauthAccount, fp };
    await this.d.secrets.store(KEY(profile.id), JSON.stringify(secret));
    const entry: SavedAccount = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      plan: profile.plan,
      organization: profile.organization,
      savedAt: Date.now(),
    };
    await this.d.list.set([entry, ...others]);
    return profile.name;
  }

  /**
   * Signs Claude Code in as a saved account. The account being left is saved first
   * (its tokens rotate as Claude uses them, and an unsaved one would be lost) and
   * the old sign-in is also kept aside. Then only the Claude sign-in in the
   * credentials file is swapped (MCP sign-ins stay), and the account part of
   * ~/.claude.json follows (backed up). If that fails, the old sign-in is put back.
   */
  async switchTo(id: string): Promise<SavedAccount> {
    const target = this.saved().find((a) => a.id === id);
    const secret = parseSecret(await this.d.secrets.get(KEY(id)));
    if (!target || !secret) throw new Error("That saved account is gone. Save it again first.");
    const store = await this.d.credentials();
    if (!store) throw new Error("Orbit can't switch accounts on this computer.");

    const json = await this.d.readClaudeJson();
    const current = profileFrom(json);
    if (current?.id === id) return target;
    if (current) await this.saveCurrent();

    const before = await store.read();
    if (before)
      await this.d.secrets.store(
        BACKUP_KEY,
        JSON.stringify({
          at: Date.now(),
          credentials: before,
          oauthAccount: identityFrom(json)?.oauthAccount ?? null,
        }),
      );
    let file: Record<string, unknown> = {};
    if (looksLikeCredentials(before)) file = JSON.parse(before) as Record<string, unknown>;
    await store.write(JSON.stringify({ ...file, claudeAiOauth: secret.oauth }));

    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const plan = await this.d.writer.planJson(this.d.claudeJsonPath, (o) => {
            o.oauthAccount = secret.oauthAccount;
          });
          await this.d.writer.apply(plan, `Switch account to ${target.email}`);
          break;
        } catch (e) {
          // Claude Code rewrites ~/.claude.json often: plan again once on the fresh file.
          if (!(e instanceof ConflictError) || attempt > 1) throw e;
        }
      }
    } catch (e) {
      if (!looksLikeCredentials(before))
        throw new Error(`${message(e)}. Log in again from Account to be safe.`);
      try {
        await store.write(before);
      } catch {
        throw new Error(
          `${message(e)}. Orbit couldn't put your previous sign-in back either: log in again from Account.`,
        );
      }
      throw new Error(`${message(e)}. Nothing was changed.`);
    }
    return target;
  }

  /** Forgets a saved account (Claude Code itself is not signed out). */
  async remove(id: string): Promise<void> {
    await this.d.secrets.delete(KEY(id));
    await this.d.list.set(this.saved().filter((a) => a.id !== id));
  }
}
