import type { Session } from "../features/chats/types";
import type { QuotaResult } from "../features/usage/quotaInstall";
import { ORBIT_LINKS } from "../shared/links";
import type { OrbitPrefs } from "../shared/protocol";
import { parseViewMsg } from "../shared/protocol";
import type { Reading } from "../shared/tabs";
import { MAX_PROMPT_IN_LINK, type Opener } from "./opener";
import type { OrbitState } from "./state";

export interface HandlerDeps {
  getSession(id: string): Session | undefined;
  opener: Pick<Opener, "continueChat" | "continueInTerminal" | "copyResume" | "newChat">;
  state: Pick<OrbitState, "setPin" | "setRename" | "setTags">;
  quota: { enable(): Promise<QuotaResult>; disable(): Promise<QuotaResult> };
  /** The current weekly recap as Markdown, or null before usage is loaded. */
  recapMarkdown(): string | null;
  copy(text: string): Promise<void>;
  saveImage(dataUrl: string, which?: "week" | "year"): Promise<void>;
  refresh(): Promise<void>;
  /** The tab the person is looking at, so only its data is read. */
  setTab(tab: Reading): void;
  /** Only links that appear in the person's own chats (PR links) may be opened. */
  isKnownLink(url: string): boolean;
  openLink(url: string): Promise<void>;
  /** VS Code settings, filtered to Orbit. */
  openOrbitSettings(): Promise<void>;
  /** Writes to Orbit's log (Output panel). */
  logError(message: string): void;
  /** Runs `orbit.<id>` (only Orbit's backup and help commands). */
  orbitCommand(
    id: "exportBrain" | "importBrain" | "runDiagnostics" | "reportProblem",
  ): Promise<void>;
  info(message: string): void;
  warn(message: string): void;
  setPref(key: keyof OrbitPrefs, value: string | number | boolean | string[]): Promise<void>;
  continueLast(): Promise<void>;
}

// "not-applied" needs no message: the person cancelled, or the reason was already shown.
const NO_NODE =
  "Plan limits needs Node.js on your PATH to run its small statusline helper. Install Node.js, then try again.";

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
      case "forkChat":
        return withSession(m.id, (s) => d.opener.continueInTerminal(s, { fork: true }));
      case "copyResume":
        return withSession(m.id, (s) => d.opener.copyResume(s));
      case "newChat": {
        const prompt = m.prompt?.trim();
        if (!prompt) return d.opener.newChat();
        if (encodeURIComponent(prompt).length <= MAX_PROMPT_IN_LINK)
          return d.opener.newChat(prompt);
        await d.opener.newChat();
        await d.copy(prompt);
        return d.info("This is long, so it's copied: paste it into Claude.");
      }
      case "pin":
        await d.state.setPin(m.id, m.on);
        return d.refresh();
      // Orbit's own names and tags, kept only for chats that exist.
      case "rename":
        if (!d.getSession(m.id)) return;
        await d.state.setRename(m.id, m.title);
        return d.refresh();
      case "tags":
        if (!d.getSession(m.id)) return;
        await d.state.setTags(m.id, m.tags);
        return d.refresh();
      case "openLink":
        if (!d.isKnownLink(m.url)) return;
        return d.openLink(m.url);
      case "openOrbitLink":
        return d.openLink(ORBIT_LINKS[m.link]);
      case "openOrbitSettings":
        return d.openOrbitSettings();
      case "orbitCommand":
        return d.orbitCommand(m.id);
      case "viewError":
        d.logError(`The ${m.where} tab hit an error: ${m.message}`);
        return;
      case "setPref":
        await d.setPref(m.key, m.value);
        return d.refresh();
      case "continueLast":
        return d.continueLast();
      case "quota": {
        try {
          const r = await (m.on ? d.quota.enable() : d.quota.disable());
          if (!r.ok && r.reason === "no-node") d.warn(NO_NODE);
          if (!r.ok && r.reason === "managed")
            d.warn(
              "Your organisation's managed settings set Claude Code's statusline, so Orbit can't show plan limits.",
            );
        } catch (e) {
          d.warn(
            `Orbit couldn't change plan limits: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        return d.refresh();
      }
      case "tab":
        d.setTab(m.tab);
        return d.refresh();
      case "copyRecap": {
        const md = d.recapMarkdown();
        if (!md) return;
        await d.copy(md);
        d.info("Recap copied as Markdown.");
        return;
      }
      case "saveRecapImage":
        return d.saveImage(m.dataUrl, m.which);
    }
  };
}
