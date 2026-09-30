import type { Session } from "../features/chats/types";
import type { QuotaResult } from "../features/usage/quotaInstall";
import { parseViewMsg } from "../shared/protocol";
import type { Opener } from "./opener";
import type { OrbitState } from "./state";

export interface HandlerDeps {
  getSession(id: string): Session | undefined;
  opener: Pick<Opener, "continueChat" | "continueInTerminal" | "copyResume" | "newChat">;
  state: Pick<OrbitState, "setPin" | "setRename">;
  quota: { enable(): Promise<QuotaResult>; disable(): Promise<QuotaResult> };
  /** The current weekly recap as Markdown, or null before usage is loaded. */
  recapMarkdown(): string | null;
  copy(text: string): Promise<void>;
  saveImage(dataUrl: string): Promise<void>;
  refresh(): Promise<void>;
  /** Only links that appear in the person's own chats (PR links) may be opened. */
  isKnownLink(url: string): boolean;
  openLink(url: string): Promise<void>;
  info(message: string): void;
  warn(message: string): void;
}

const QUOTA_PROBLEM: Record<Exclude<QuotaResult, { ok: true }>["reason"], string> = {
  "no-node":
    "Plan limits needs Node.js on your PATH to run its small statusline helper. Install Node.js, then try again.",
  unparseable:
    "Claude's settings.json isn't plain JSON (comments or a typo?), so Orbit didn't touch it. Fix the file, then try again.",
  conflict:
    "Claude's settings.json changed while Orbit was saving. Nothing was written. Try again.",
};

/** Validates every message from the webview, then performs exactly one action for it. */
export function createHandler(d: HandlerDeps): (raw: unknown) => Promise<void> {
  const withSession = async (id: string, fn: (s: Session) => Promise<void>) => {
    const s = d.getSession(id);
    if (s) return fn(s);
    d.warn("This chat is no longer on disk. Refreshing the list.");
    await d.refresh();
  };

  return async (raw) => {
    const m = parseViewMsg(raw);
    if (!m) return;
    switch (m.type) {
      case "ready":
      case "refresh":
        return d.refresh();
      case "openChat":
        return withSession(m.id, (s) => d.opener.continueChat(s));
      case "openTerminal":
        return withSession(m.id, (s) => d.opener.continueInTerminal(s));
      case "copyResume":
        return withSession(m.id, (s) => d.opener.copyResume(s));
      case "newChat":
        return d.opener.newChat();
      case "pin":
        await d.state.setPin(m.id, m.on);
        return d.refresh();
      case "rename":
        await d.state.setRename(m.id, m.title);
        return d.refresh();
      case "openLink":
        if (!d.isKnownLink(m.url)) return;
        return d.openLink(m.url);
      case "quota": {
        const r = await (m.on ? d.quota.enable() : d.quota.disable());
        if (!r.ok) d.warn(QUOTA_PROBLEM[r.reason]);
        return d.refresh();
      }
      case "copyRecap": {
        const md = d.recapMarkdown();
        if (!md) return;
        await d.copy(md);
        d.info("Recap copied as Markdown.");
        return;
      }
      case "saveRecapImage":
        return d.saveImage(m.dataUrl);
    }
  };
}
