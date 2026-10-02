import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SafeWriter } from "../../../core/safeWriter";
import { type AccountDeps, Accounts, type SavedAccount } from "../accounts";
import {
  type CredentialStore,
  credentialStore,
  FileCredentials,
  looksLikeCredentials,
} from "../credentials";
import { planLabel, profileFrom } from "../profile";

const creds = (token: string) =>
  JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: `r-${token}` } });
const account = (id: string, email: string) => ({
  accountUuid: id,
  emailAddress: email,
  displayName: email.split("@")[0],
  organizationName: `${id} org`,
  organizationType: "claude_team",
});

let dir: string;
let claudeJson: string;
let credFile: string;
let secrets: Map<string, string>;
let list: SavedAccount[];
let memo: Map<string, unknown>;

function deps(over: Partial<AccountDeps> = {}): AccountDeps {
  return {
    claudeJsonPath: claudeJson,
    readClaudeJson: async () => JSON.parse(readFileSync(claudeJson, "utf8")),
    credentials: async () => new FileCredentials(credFile),
    secrets: {
      get: async (k) => secrets.get(k),
      store: async (k, v) => void secrets.set(k, v),
      delete: async (k) => void secrets.delete(k),
    },
    list: {
      get: () => list,
      set: async (v) => {
        list = v;
      },
    },
    memo: {
      get: (k, d) => (memo.has(k) ? memo.get(k) : d) as never,
      set: async (k, v) => {
        memo.set(k, v);
      },
    },
    writer: new SafeWriter(join(dir, "backups")),
    ...over,
  };
}

const signIn = (id: string, email: string, token: string) => {
  writeFileSync(
    claudeJson,
    JSON.stringify(
      { numStartups: 7, userID: `u-${id}`, oauthAccount: account(id, email) },
      null,
      2,
    ),
  );
  writeFileSync(credFile, creds(token));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orbit-acc-"));
  claudeJson = join(dir, ".claude.json");
  credFile = join(dir, ".credentials.json");
  secrets = new Map();
  list = [];
  memo = new Map();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("profile", () => {
  it("reads who is signed in, without tokens, with a short plan name", () => {
    const p = profileFrom({ oauthAccount: account("a", "ana@x.com") });
    expect(p).toMatchObject({ id: "a", name: "ana", email: "ana@x.com", plan: "Team" });
    expect(profileFrom({})).toBeNull();
    expect(profileFrom({ oauthAccount: { emailAddress: "no-id@x.com" } })).toBeNull();
  });

  it("names Max tiers with their size", () => {
    expect(
      planLabel({ organizationType: "claude_max", userRateLimitTier: "default_claude_max_20x" }),
    ).toBe("Max 20x");
    expect(planLabel({ organizationType: "claude_pro" })).toBe("Pro");
    expect(planLabel({})).toBeNull();
  });
});

describe("Accounts", () => {
  it("saves the signed-in account in secret storage and lists it without tokens", async () => {
    signIn("a", "ana@x.com", "tokA");
    const acc = new Accounts(deps());
    expect(await acc.saveCurrent()).toBe("ana");
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("tokA");
    expect(secrets.get("orbit.account.a")).toContain("tokA");
    const snap = await acc.snapshot();
    expect(snap.profile?.email).toBe("ana@x.com");
    expect(snap.saved.map((s) => s.id)).toEqual(["a"]);
  });

  it("switches: identity into .claude.json (other keys kept), tokens into the credentials file", async () => {
    signIn("b", "bo@x.com", "tokB");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    signIn("a", "ana@x.com", "tokA");
    await acc.saveCurrent();
    // Claude refreshed A's token since it was saved.
    writeFileSync(credFile, creds("tokA2"));

    await acc.switchTo("b");
    const json = JSON.parse(readFileSync(claudeJson, "utf8"));
    expect(json.oauthAccount.accountUuid).toBe("b");
    expect(json.userID).toBe("u-a");
    expect(json.numStartups).toBe(7);
    expect(readFileSync(credFile, "utf8")).toContain("tokB");
    // The account left behind was re-saved with its fresh token.
    expect(secrets.get("orbit.account.a")).toContain("tokA2");
  });

  it("puts .claude.json back when the tokens can't be written", async () => {
    signIn("b", "bo@x.com", "tokB");
    const failing: CredentialStore = {
      kind: "file",
      read: async () => creds("tokA"),
      write: async () => {
        throw new Error("disk full");
      },
    };
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    signIn("a", "ana@x.com", "tokA");
    const before = readFileSync(claudeJson, "utf8");
    await expect(
      new Accounts(deps({ credentials: async () => failing })).switchTo("b"),
    ).rejects.toThrow("disk full");
    expect(readFileSync(claudeJson, "utf8")).toBe(before);
  });

  it("refuses to save when there are no readable tokens, and forgets accounts on request", async () => {
    signIn("a", "ana@x.com", "tokA");
    writeFileSync(credFile, "not json");
    const acc = new Accounts(deps());
    await expect(acc.saveCurrent()).rejects.toThrow(/can't read/);
    writeFileSync(credFile, creds("tokA"));
    await acc.saveCurrent();
    await acc.remove("a");
    expect(list).toEqual([]);
    expect(secrets.has("orbit.account.a")).toBe(false);
  });

  it("does nothing when switching to the account already in use", async () => {
    signIn("a", "ana@x.com", "tokA");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    const before = readFileSync(claudeJson, "utf8");
    await acc.switchTo("a");
    expect(readFileSync(claudeJson, "utf8")).toBe(before);
  });
});

describe("credentials", () => {
  it("only accepts real Claude sign-in details", () => {
    expect(looksLikeCredentials(creds("t"))).toBe(true);
    expect(looksLikeCredentials('{"x":1}')).toBe(false);
    expect(looksLikeCredentials(null)).toBe(false);
  });

  it("refuses to write anything else over the credentials file", async () => {
    writeFileSync(credFile, creds("keep"));
    await expect(new FileCredentials(credFile).write("{}")).rejects.toThrow();
    expect(readFileSync(credFile, "utf8")).toContain("keep");
  });
});

describe("Accounts: nothing is ever lost", () => {
  it("swaps only the Claude sign-in, keeping MCP sign-ins and other keys in the credentials file", async () => {
    signIn("b", "bo@x.com", "tokB");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    signIn("a", "ana@x.com", "tokA");
    writeFileSync(
      credFile,
      JSON.stringify({ claudeAiOauth: { accessToken: "tokA" }, mcpOAuth: { github: "keep-me" } }),
    );
    await acc.switchTo("b");
    const c = JSON.parse(readFileSync(credFile, "utf8"));
    expect(c.claudeAiOauth.accessToken).toBe("tokB");
    expect(c.mcpOAuth).toEqual({ github: "keep-me" });
  });

  it("saves the account being left first, so switching never loses a login", async () => {
    signIn("b", "bo@x.com", "tokB");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    signIn("a", "ana@x.com", "tokA");
    await acc.switchTo("b");
    expect(list.map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(secrets.get("orbit.account.a")).toContain("tokA");
  });

  it("keeps the install's own userID (it isn't part of an account)", async () => {
    signIn("b", "bo@x.com", "tokB");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    signIn("a", "ana@x.com", "tokA");
    await acc.switchTo("b");
    expect(JSON.parse(readFileSync(claudeJson, "utf8")).userID).toBe("u-a");
  });

  it("refuses to save tokens that belong to another saved account", async () => {
    signIn("a", "ana@x.com", "tokA");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    // A running chat wrote A's tokens back after ~/.claude.json already said B.
    writeFileSync(
      claudeJson,
      JSON.stringify({ userID: "u", oauthAccount: account("b", "bo@x.com") }),
    );
    await expect(acc.saveCurrent()).rejects.toThrow(/belongs to ana@x.com/);
    expect(list.map((s) => s.id)).toEqual(["a"]);
  });

  it("puts the old tokens back when ~/.claude.json can't be written", async () => {
    signIn("b", "bo@x.com", "tokB");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    signIn("a", "ana@x.com", "tokA");
    const broken = new Accounts(
      deps({
        writer: {
          planJson: async () => {
            throw new Error("locked");
          },
          apply: async () => {
            throw new Error("locked");
          },
          undo: async () => {},
        },
      }),
    );
    await expect(broken.switchTo("b")).rejects.toThrow(/locked/);
    expect(readFileSync(credFile, "utf8")).toContain("tokA");
    expect(JSON.parse(readFileSync(claudeJson, "utf8")).oauthAccount.accountUuid).toBe("a");
  });

  it("doesn't switch on macOS, where Claude keeps its sign-in in the Keychain", async () => {
    expect(await credentialStore(dir, "darwin")).toBeNull();
    expect((await credentialStore(dir, "linux"))?.kind).toBe("file");
  });

  it("ignores account ids Orbit couldn't safely use as keys", () => {
    expect(
      profileFrom({ oauthAccount: { accountUuid: "a/../b", emailAddress: "x@y.z" } }),
    ).toBeNull();
  });
});

describe("Accounts: last seen plan limits", () => {
  const quota = (seven: number, at: number) => ({
    v: 1 as const,
    updatedAt: at,
    sessionId: null,
    model: null,
    contextPct: null,
    costUsd: null,
    fiveHour: { pct: 10, resetsAt: at + 3_600_000 },
    sevenDay: { pct: seven, resetsAt: at + 3 * 86_400_000 },
    spendLimit: null,
  });

  it("remembers each account's weekly use and shows it on its saved row", async () => {
    signIn("a", "ana@x.com", "tokA");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    await acc.remember(quota(62, Date.now() - 3 * 3_600_000));
    const snap = await acc.snapshot();
    expect(snap.saved[0]?.lastSeen).toBe("62% weekly · 3h ago");
  });

  it("keeps only the newest reading, and forgets one from before the week reset", async () => {
    signIn("a", "ana@x.com", "tokA");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    await acc.remember(quota(62, Date.now() - 60_000));
    await acc.remember(quota(20, Date.now() - 3 * 3_600_000));
    expect((await acc.snapshot()).saved[0]?.lastSeen).toMatch(/^62% weekly/);
    const old = quota(50, Date.now() - 5 * 86_400_000);
    await acc.remember(old);
    expect((await acc.snapshot()).saved[0]?.lastSeen).toMatch(/^62% weekly/);
  });

  it("marks when the account was switched, so older numbers aren't shown as the new account's", async () => {
    signIn("b", "bo@x.com", "tokB");
    const acc = new Accounts(deps());
    await acc.saveCurrent();
    signIn("a", "ana@x.com", "tokA");
    const before = Date.now();
    await acc.switchTo("b");
    expect((await acc.snapshot()).switchedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("Accounts: sign-in health", () => {
  it("says how many days the sign-in has left, without the tokens", async () => {
    signIn("a", "ana@x.com", "tokA");
    writeFileSync(
      credFile,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "tokA",
          refreshTokenExpiresAt: Date.now() + 9.5 * 86_400_000,
        },
      }),
    );
    const snap = await new Accounts(deps()).snapshot();
    expect(snap.signInDays).toBe(9);
    expect(JSON.stringify(snap)).not.toContain("tokA");
  });

  it("reports a broken ~/.claude.json with the backup to restore", async () => {
    signIn("a", "ana@x.com", "tokA");
    const acc = new Accounts(
      deps({
        health: async () => ({ broken: true, backup: "/b/.claude.json.backup.1", backupAt: 1 }),
      }),
    );
    expect((await acc.snapshot()).broken).toEqual({
      backup: "/b/.claude.json.backup.1",
      backupAt: 1,
    });
  });
});
