const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Claude Code session ids are UUIDs. Anything else is refused before it reaches a link or argument. */
export function isSessionId(v: unknown): v is string {
  return typeof v === "string" && SESSION_ID.test(v);
}
