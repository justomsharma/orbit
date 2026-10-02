import type { LiveState } from "../../features/chats/types";

/** Short words for a running chat's state, shown next to it. */
export const LIVE_LABEL: Record<LiveState, string> = {
  busy: "Working…",
  idle: "Waiting for you",
  waiting: "Needs your answer",
  unknown: "Running",
};

/** The longer explanation, for tooltips and screen readers. */
export const LIVE_TITLE: Record<LiveState, string> = {
  busy: "Claude is working",
  idle: "Claude is done and waiting for your next message",
  waiting: "Claude asked you something or needs permission, and is waiting",
  unknown: "This chat is running",
};

/** The dot's colour and pulse. */
export const liveClass = (s: LiveState) => (s === "unknown" ? "busy" : s);
