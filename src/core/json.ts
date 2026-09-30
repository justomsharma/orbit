const BOM = "﻿";

/** Indentation of the first indented line: `"\t"` or a number of spaces. Defaults to 2. */
export function detectIndent(text: string): string | number {
  const m = text.match(/^([ \t]+)\S/m);
  if (!m?.[1]) return 2;
  if (m[1].startsWith("\t")) return "\t";
  return m[1].length;
}

/**
 * JSON text for `value` that looks like `original`: same indentation, same line
 * endings (CRLF kept), same trailing newline, same BOM. A new or empty original
 * gets 2 spaces and a trailing newline.
 */
export function stringifyLike(value: unknown, original: string | null): string {
  const orig = original ?? "";
  const bom = orig.startsWith(BOM) ? BOM : "";
  const body = bom ? orig.slice(1) : orig;
  const crlf = body.includes("\r\n");
  const trailing = body.trim() === "" || /\n$/.test(body);
  let out = JSON.stringify(value, null, detectIndent(body));
  if (trailing) out += "\n";
  // JSON.stringify escapes newlines inside strings, so every "\n" here is a line break.
  if (crlf) out = out.replace(/\n/g, "\r\n");
  return bom + out;
}

/** Parses text that must be a JSON object. `null` for anything else (arrays, comments, junk). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
