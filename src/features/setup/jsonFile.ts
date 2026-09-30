import { MiB, readTextSafe, statSafe } from "../../core/fsSafe";
import { parseJsonObject } from "../../core/json";

/** A config file that must hold one JSON object. `error` is short and safe to show. */
export interface JsonFile {
  path: string;
  exists: boolean;
  data: Record<string, unknown> | null;
  error: string | null;
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

/** Reads a JSON object file. Never throws; problems land in `error`. */
export async function readJsonFile(path: string, maxBytes = MiB): Promise<JsonFile> {
  const fail = (error: string): JsonFile => ({ path, exists: true, data: null, error });
  const st = await statSafe(path);
  if (!st) return { path, exists: false, data: null, error: null };
  if (st.isSymbolicLink()) return fail("It is a symbolic link; Orbit does not follow links");
  if (!st.isFile()) return fail("Not a file");
  if (st.size > maxBytes)
    return fail(`Too large to read (over ${Math.round((maxBytes / MiB) * 10) / 10} MB)`);
  const text = await readTextSafe(path, maxBytes);
  if (text === null) return fail("Could not be read");
  const data = parseJsonObject(text);
  return data ? { path, exists: true, data, error: null } : fail(jsonProblem(text));
}
