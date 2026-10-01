import type { Step } from "../shared/onboarding";
import { parseViewMsg } from "../shared/protocol";

/** The getting-started step a webview message completes, if any. Invalid messages count for nothing. */
export function stepFor(raw: unknown): Step | null {
  const m = parseViewMsg(raw);
  if (!m) return null;
  switch (m.type) {
    case "openChat":
    case "openTerminal":
    case "forkChat":
      return "continue";
    case "chat:details":
      return "details";
    case "tab":
      return m.tab === "setup" ? "setup" : null;
    case "quota":
      return m.on ? "limits" : null;
    case "onboarding":
      return m.action === "find" ? "find" : null;
    default:
      return null;
  }
}
