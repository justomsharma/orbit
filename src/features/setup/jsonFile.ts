import { MiB, readTextSafe, realpathSafe, statSafe } from "../../core/fsSafe";
import { parseJsonObject } from "../../core/json";

/** Read caps. Plugin and project files are small. */
export const JSON_MAX = MiB;
/** Settings can hold thousands of permission rules. */
export const SETTINGS_MAX = 4 * MiB;
/** `~/.claude.json` keeps per-project history and grows to many MB on long-used machines. */
export const CLAUDE_JSON_MAX = 32 * MiB;

/**
 * Why Orbit left a file unread — a limit of Orbit's, not a fault in the file:
 * over the size cap, a link Orbit was not asked to follow, or not a regular
 * file Orbit can open (a folder, a broken link, no permission).
 */
export type Skipped = "too-large" | "link" | "unreadable";

/** A config file that must hold one JSON object. */
export interface JsonFile {
  path: string;
  exists: boolean;
  data: Record<string, unknown> | null;
  /** Set only when the file was read and is not a JSON object. Short and safe to show. */
  error: string | null;
  skipped: Skipped | null;
}

const BOM = "﻿";

const lineAt = (text: string, pos: number) => text.slice(0, pos).split("\n").length;

/** First comment or trailing comma outside strings, if any. */
function jsoncFeature(text: string): { kind: "comment" | "comma"; pos: number } | null {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*"))
      return { kind: "comment", pos: i };
    else if (c === ",") {
      const next = text.slice(i + 1).match(/^\s*(\S)/)?.[1];
      if (next === "}" || next === "]") return { kind: "comma", pos: i };
    }
  }
  return null;
}

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return typeof v === "number" ? "a number" : `a ${typeof v}`;
}

/**
 * Why `text` is not a JSON object, in a few plain words. Never quotes the text
 * itself (it may hold secrets) — only line and column numbers.
 */
export function jsonProblem(text: string): string {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  if (body.trim() === "") return "Not valid JSON: the file is empty";
  try {
    const v: unknown = JSON.parse(body);
    return `Expected a JSON object at the top level, found ${kindOf(v)}`;
  } catch (e) {
    const f = jsoncFeature(body);
    if (f?.kind === "comment")
      return `Not valid JSON: comments are not allowed (line ${lineAt(body, f.pos)})`;
    if (f?.kind === "comma")
      return `Not valid JSON: trailing commas are not allowed (line ${lineAt(body, f.pos)})`;
    const pos = Number((e instanceof Error ? e.message : "").match(/position (\d+)/)?.[1]);
    if (!Number.isFinite(pos)) return "Not valid JSON: syntax error";
    const before = body.slice(0, pos).split("\n");
    return `Not valid JSON: syntax error at line ${before.length}, column ${before.at(-1)!.length + 1}`;
  }
}

export interface ReadJsonOptions {
  maxBytes?: number;
  /**
   * Read through a symbolic link (dotfile managers like stow and chezmoi link
   * settings files). The target must still be a regular file under the cap.
   */
  followLinks?: boolean;
}

/** Reads a JSON object file. Never throws; see `JsonFile` for `error` and `skipped`. */
export async function readJsonFile(
  path: string,
  { maxBytes = JSON_MAX, followLinks = false }: ReadJsonOptions = {},
): Promise<JsonFile> {
  const skip = (skipped: Skipped): JsonFile => ({
    path,
    exists: true,
    data: null,
    error: null,
    skipped,
  });
  let st = await statSafe(path);
  if (!st) return { path, exists: false, data: null, error: null, skipped: null };
  let file = path;
  if (st.isSymbolicLink()) {
    if (!followLinks) return skip("link");
    // Read-only, so following is safe: the target gets the same checks as any file.
    const real = await realpathSafe(path);
    st = real ? await statSafe(real) : null;
    if (!real || !st) return skip("unreadable");
    file = real;
  }
  if (!st.isFile()) return skip("unreadable");
  if (st.size > maxBytes) return skip("too-large");
  const text = await readTextSafe(file, maxBytes);
  if (text === null) return skip("unreadable");
  const data = parseJsonObject(text);
  return data
    ? { path, exists: true, data, error: null, skipped: null }
    : { path, exists: true, data: null, error: jsonProblem(text), skipped: null };
}
