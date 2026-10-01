/** Who is signed in to Claude Code, from ~/.claude.json. Never includes tokens. */
export interface Profile {
  /** Anthropic's id for the account (stable across logins). */
  id: string;
  name: string;
  email: string;
  organization: string | null;
  role: string | null;
  /** "Team", "Max 20x", "Pro"… or null when unknown. */
  plan: string | null;
  /** When Claude Code first used this account (ISO), if known. */
  since: string | null;
}

const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A short plan name from Claude Code's account fields: the organisation type
 * ("claude_team" → "Team") and, for Max, the rate tier ("…max_20x" → "Max 20x").
 */
export function planLabel(account: Record<string, unknown>): string | null {
  const type = str(account.organizationType, 60)?.toLowerCase() ?? "";
  const tier = `${str(account.userRateLimitTier, 80) ?? ""} ${str(account.organizationRateLimitTier, 80) ?? ""}`;
  const times = tier.match(/(\d+)\s*x\b/i)?.[1];
  const kind = type.match(/^claude_([a-z]+)$/)?.[1];
  if (kind) return times && kind === "max" ? `Max ${times}x` : cap(kind);
  if (/max/i.test(tier)) return times ? `Max ${times}x` : "Max";
  if (/pro/i.test(tier)) return "Pro";
  return null;
}

/** The signed-in account, or null when Claude Code isn't signed in to a Claude account. */
export function profileFrom(claudeJson: unknown): Profile | null {
  if (!claudeJson || typeof claudeJson !== "object") return null;
  const a = (claudeJson as Record<string, unknown>).oauthAccount;
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const acc = a as Record<string, unknown>;
  const id = str(acc.accountUuid, 100);
  const email = str(acc.emailAddress, 320);
  if (!id || !email || !/^[\w-]{1,100}$/.test(id)) return null;
  const name = str(acc.displayName, 120) ?? str(acc.fullName, 120) ?? email.split("@")[0]!;
  return {
    id,
    name,
    email,
    organization: str(acc.organizationName, 200),
    role: str(acc.organizationRole, 60),
    plan: planLabel(acc),
    since: str((claudeJson as Record<string, unknown>).claudeCodeFirstTokenDate, 40),
  };
}

/** What a saved account keeps besides its credentials: the identity Claude Code reads. */
export function identityFrom(
  claudeJson: unknown,
): { oauthAccount: Record<string, unknown>; userID: string | null } | null {
  if (!claudeJson || typeof claudeJson !== "object") return null;
  const o = claudeJson as Record<string, unknown>;
  const a = o.oauthAccount;
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  return { oauthAccount: a as Record<string, unknown>, userID: str(o.userID, 200) };
}
