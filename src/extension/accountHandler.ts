import type { Accounts } from "../features/account/accounts";
import { parseViewMsg } from "../shared/protocol";

export interface PickItem {
  id: string;
  label: string;
  description?: string;
  detail?: string;
}

export interface AccountHandlerDeps {
  accounts: Pick<Accounts, "snapshot" | "saveCurrent" | "switchTo" | "remove">;
  /** Runs `claude <args>` in a terminal the person can see. */
  runClaude(args: string[]): Promise<void>;
  /** A modal question; resolves to the chosen action, or undefined when cancelled. */
  ask(message: string, detail: string, ...actions: string[]): Promise<string | undefined>;
  pick(title: string, items: PickItem[]): Promise<string | undefined>;
  /** How many Claude chats are running right now. */
  running(): number;
  info(message: string): void;
  warn(message: string): void;
  refresh(): Promise<void>;
}

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Account actions from the view: every change asks first and says what happened. */
export async function handleAccount(raw: unknown, d: AccountHandlerDeps): Promise<boolean> {
  const m = parseViewMsg(raw);
  if (!m?.type.startsWith("account:")) return false;

  const login = async () => {
    const snap = await d.accounts.snapshot();
    const p = snap.profile;
    if (p && !snap.saved.some((a) => a.id === p.id)) {
      const pick = await d.ask(
        `Save ${p.email} before logging in with another account?`,
        "Then you can switch back to it later without logging in again.",
        "Save and log in",
        "Log in anyway",
      );
      if (!pick) return;
      if (pick === "Save and log in") await save();
    }
    await d.runClaude(["auth", "login"]);
  };

  const save = async () => {
    try {
      const name = await d.accounts.saveCurrent();
      d.info(`Saved ${name}. Switch back to it any time from Account, without logging in.`);
    } catch (e) {
      d.warn(err(e));
    }
  };

  const switchTo = async (id: string) => {
    const snap = await d.accounts.snapshot();
    const target = snap.saved.find((a) => a.id === id);
    if (!target) return d.warn("That saved account is gone. Save it again first.");
    if (snap.profile?.id === id) return d.info(`You're already using ${target.email}.`);
    const n = d.running();
    if (n)
      return d.warn(
        `${n} chat${n === 1 ? " is" : "s are"} running. Close ${n === 1 ? "it" : "them"} first: a running chat can sign the old account back in.`,
      );
    const detail = [
      "New chats use this account straight away.",
      snap.profile ? `Orbit saves ${snap.profile.email} first, so you can switch back.` : "",
      "Orbit backs up ~/.claude.json and your current sign-in first.",
    ]
      .filter(Boolean)
      .join("\n\n");
    if ((await d.ask(`Switch Claude Code to ${target.email}?`, detail, "Switch")) !== "Switch")
      return;
    try {
      await d.accounts.switchTo(id);
      d.info(`Switched to ${target.email}. New chats use it now.`);
    } catch (e) {
      d.warn(`Couldn't switch accounts: ${err(e)}`);
    }
  };

  switch (m.type) {
    case "account:login":
      await login();
      break;
    case "account:logout": {
      const pick = await d.ask(
        "Log out of Claude Code?",
        "Chats can't reach Claude until you log in again. Other accounts saved in Orbit stay saved; this one's saved copy may stop working, so save it again after you next log in.",
        "Log out",
      );
      if (pick === "Log out") await d.runClaude(["auth", "logout"]);
      break;
    }
    case "account:save":
      await save();
      break;
    case "account:switch":
      await switchTo(m.id);
      break;
    case "account:remove": {
      const a = (await d.accounts.snapshot()).saved.find((x) => x.id === m.id);
      if (!a) break;
      const pick = await d.ask(
        `Forget ${a.email} in Orbit?`,
        "Claude Code stays signed in as it is. Orbit only deletes its saved copy of this sign-in.",
        "Forget",
      );
      if (pick === "Forget") await d.accounts.remove(m.id);
      break;
    }
    case "account:pick": {
      const snap = await d.accounts.snapshot();
      const activeSaved = snap.saved.some((a) => a.id === snap.profile?.id);
      const items: PickItem[] = [
        ...snap.saved.map((a) => ({
          id: a.id,
          label: `${a.id === snap.profile?.id ? "$(check)" : "$(account)"} ${a.name}`,
          description: a.id === snap.profile?.id ? "In use" : (a.plan ?? undefined),
          detail: [a.email, a.organization].filter(Boolean).join(" · "),
        })),
        ...(snap.profile && !activeSaved
          ? [{ id: "\0save", label: "$(save) Save this account", description: snap.profile.email }]
          : []),
        { id: "\0login", label: "$(sign-in) Log in with another account" },
      ];
      const id = await d.pick("Switch Claude account", items);
      if (id === "\0save") await save();
      else if (id === "\0login") await login();
      else if (id) await switchTo(id);
      break;
    }
  }
  await d.refresh();
  return true;
}
