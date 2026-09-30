export type JsonObject = Record<string, unknown>;

/**
 * Calls `fn` for every line that parses to a JSON object. Blank, corrupt and
 * half-written lines (Claude may be mid-write) are skipped silently.
 */
export function forEachJsonLine(text: string, fn: (obj: JsonObject) => void): void {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (!line.startsWith("{")) continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) fn(v as JsonObject);
  }
}

export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export const obj = (v: unknown): JsonObject | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : null;
