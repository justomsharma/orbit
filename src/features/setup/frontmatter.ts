import { parseDocument } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  error: string | null;
}

const NOT_OBJECT = "Frontmatter should be a list of key: value pairs";

/** Next line of `text` from `start`: its content (no line ending) and where the following line starts. */
function lineAt(text: string, start: number): { line: string; next: number } {
  const nl = text.indexOf("\n", start);
  const end = nl === -1 ? text.length : nl;
  const line = text.slice(start, end).replace(/\r$/, "");
  return { line, next: nl === -1 ? text.length : nl + 1 };
}

/** Parses YAML into a plain object, or explains why it could not. */
function parseYaml(src: string): { data: Record<string, unknown>; error: string | null } {
  try {
    const doc = parseDocument(src, { strict: false, uniqueKeys: false, logLevel: "silent" });
    if (doc.errors.length > 0) {
      const first = doc.errors[0]!.message.split("\n")[0];
      return { data: {}, error: `Frontmatter is not valid YAML: ${first}` };
    }
    const v: unknown = doc.toJS({ maxAliasCount: 100 });
    if (v === null || v === undefined) return { data: {}, error: null };
    if (typeof v !== "object" || Array.isArray(v)) return { data: {}, error: NOT_OBJECT };
    return { data: v as Record<string, unknown>, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return { data: {}, error: `Frontmatter is not valid YAML: ${msg}` };
  }
}

/**
 * Claude Code's docs write hints like `argument-hint: [pr] [priority]`, which
 * is not valid YAML. When parsing fails, top-level values starting with `[`
 * are retried as plain strings before the error is reported.
 */
function parseLenient(src: string) {
  const first = parseYaml(src);
  if (!first.error) return first;
  // Also one-line values with ": " inside (a sentence like "persona: ideas, rules"),
  // which Claude reads as plain text too. Other values (true, 3, lists) stay as they are.
  const quoted = src.replace(
    /^([\w-]+):[ \t]+([^\s"'|>&*!#][^\r\n]*?)[ \t]*$/gm,
    (line: string, k: string, v: string) =>
      v.startsWith("[") || v.includes(": ") ? `${k}: ${JSON.stringify(v)}` : line,
  );
  if (quoted === src) return first;
  const retry = parseYaml(quoted);
  return retry.error ? first : retry;
}

/**
 * Splits a Markdown file into its YAML frontmatter and body. Frontmatter only
 * counts when the very first line is `---`; it ends at the next `---` line.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const src = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const first = lineAt(src, 0);
  if (first.line.trimEnd() !== "---") return { data: {}, body: text, error: null };
  let pos = first.next;
  while (pos < src.length) {
    const { line, next } = lineAt(src, pos);
    if (line.trimEnd() === "---") {
      const { data, error } = parseLenient(src.slice(first.next, pos));
      return { data, body: src.slice(next), error };
    }
    pos = next;
  }
  return { data: {}, body: src.slice(first.next), error: "Frontmatter is not closed" };
}
