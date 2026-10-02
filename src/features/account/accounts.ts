import { createHash } from "node:crypto";
import { ConflictError, type EditPlan, type UndoEntry } from "../../core/safeWriter";
import type { QuotaFile } from "../../tap/statusline";
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
  /** "62% weekly · 3h ago": its plan limits when last used here, if still meaningful. */
  lastSeen?: string;
}

export interface AccountSnapshot {
  profile: Profile | null;
  saved: SavedAccount[];
  /** Saved accounts can be switched on this machine. */
  canSwitch: boolean;
  /** When Orbit last switched accounts (plan limits from before belong to the old one). */
  switchedAt: number | null;
  /** Days until Claude Code's sign-in needs logging in again, when known. */
  signInDays?: number | null;
  /** ~/.claude.json is empty or broken; the newest backup Claude Code kept, if any. */
  broken?: { backup: string | null; backupAt: number | null } | null;
}

/** One account's plan limits when Claude last reported them. */
interface Seen {
  seven: number | null;
  five: number | null;
  sevenResetsAt: number | null;
  at: number;
}

const SEEN_KEY = "orbit.quotaSeen";
const SWITCHED_KEY = "orbit.switchedAt";
const MAX_SEEN = 20;

function ago(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** "62% weekly · 3h ago", or "" when there's no weekly number or it's out of date. */
export function describeSeen(s: Seen | undefined, now: number): string {
  if (!s || s.seven === null) return "";
  if (now - s.at >= 7 * 86_400_000 || (s.sevenResetsAt !== null && s.sevenResetsAt <= now))
    return "";
  return `${Math.round(s.seven)}% weekly · ${ago(now - s.at)}`;
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
  /** Small non-secret notes (last-seen limits, switch time), e.g. in globalState. */
  memo: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): PromiseLike<void>;
  };
  writer: {
    planJson(file: string, mutate: (o: Record<string, unknown>) => void): Promise<EditPlan>;
    apply(plan: EditPlan, label: string): Promise<UndoEntry>;
    undo(id: string): Promise<void>;
  };
  /** Whether ~/.claude.json is broken, and the newest backup to restore from. */
  health?(): Promise<{ broken: boolean; backup: string | null; backupAt: number | null }>;
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

/** Whole days until the sign-in's refresh token runs out (never shows the token). */
export function signInDays(credentials: string | null, now: number): number | null {
  if (!looksLikeCredentials(credentials)) return null;
  const o = oauthOf(credentials);
  const at = typeof o.refreshTokenExpiresAt === "number" ? o.refreshTokenExpiresAt : null;
  if (!at || at <= now) return at ? 0 : null;
  return Math.floor((at - now) / 86_400_000);
}

/** Saving, switching and forgetting Claude Code accounts, done safely. */
export class Accounts {
  constructor(private readonly d: AccountDeps) {}

  private saved(): SavedAccount[] {
    const v = this.d.list.get();
    return Array.isArray(v) ? v.filter((a) => a && typeof a.id === "string") : [];
  }

  async snapshot(): Promise<AccountSnapshot> {
    const profile = profileFrom(await this.d.readClaudeJson());
    const seen = this.d.memo.get<Record<string, Seen>>(SEEN_KEY, {});
    const now = Date.now();
    const saved = this.saved().map((a) => {
      const lastSeen = describeSeen(seen[a.id], now);
      return lastSeen ? { ...a, lastSeen } : a;
    });
    const switchedAt = this.d.memo.get<number | null>(SWITCHED_KEY, null);
    const store = await this.d.credentials();
    const h = await this.d.health?.().catch(() => null);
    return {
      profile,
      saved,
      canSwitch: store !== null,
      switchedAt: typeof switchedAt === "number" ? switchedAt : null,
      signInDays: profile && store ? signInDays(await store.read(), now) : null,
      broken: h?.broken ? { backup: h.backup, backupAt: h.backupAt } : null,
    };
  }

  /** Keeps the signed-in account's latest plan limits, to show after switching away. */
  async remember(q: QuotaFile | null): Promise<void> {
    if (!q || (!q.sevenDay && !q.fiveHour)) return;
    const switchedAt = this.d.memo.get<number | null>(SWITCHED_KEY, null);
    if (typeof switchedAt === "number" && q.updatedAt < switchedAt) return;
    const id = profileFrom(await this.d.readClaudeJson())?.id;
    if (!id) return;
    const all = { ...this.d.memo.get<Record<string, Seen>>(SEEN_KEY, {}) };
    if ((all[id]?.at ?? 0) >= q.updatedAt) return;
    all[id] = {
      seven: q.sevenDay?.pct ?? null,
      five: q.fiveHour?.pct ?? null,
      sevenResetsAt: q.sevenDay?.resetsAt ?? null,
      at: q.updatedAt,
    };
    const newest = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_SEEN);
    await this.d.memo.set(SEEN_KEY, Object.fromEntries(newest));
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
    await this.d.memo.set(SWITCHED_KEY, Date.now());
    return target;
  }

  /** Forgets a saved account (Claude Code itself is not signed out). */
  async remove(id: string): Promise<void> {
    await this.d.secrets.delete(KEY(id));
    await this.d.list.set(this.saved().filter((a) => a.id !== id));
  }
}
