import type { Session } from "../features/chats/types";
import { parseViewMsg } from "../shared/protocol";
import type { Opener } from "./opener";
import type { OrbitState } from "./state";

export interface HandlerDeps {
  getSession(id: string): Session | undefined;
  opener: Pick<Opener, "continueChat" | "continueInTerminal" | "copyResume">;
  state: Pick<OrbitState, "setPin" | "setRename">;
  refresh(): Promise<void>;
  /** Only links that appear in the person's own chats (PR links) may be opened. */
  isKnownLink(url: string): boolean;
  openLink(url: string): Promise<void>;
  warn(message: string): void;
}

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
      case "pin":
        await d.state.setPin(m.id, m.on);
        return d.refresh();
      case "rename":
        await d.state.setRename(m.id, m.title);
        return d.refresh();
      case "openLink":
        if (!d.isKnownLink(m.url)) return;
        return d.openLink(m.url);
    }
  };
}
