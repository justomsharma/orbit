import { type JsonObject, num, obj, str } from "../../core/jsonl";
import type { UsageRecord } from "./types";

const n = (v: unknown) => Math.max(0, num(v) ?? 0);

/** Usage of one parsed transcript line, or null when it isn't a billed assistant reply. */
export function usageFromObject(l: JsonObject, fallbackSession: string): UsageRecord | null {
  if (l.type !== "assistant") return null;
  const m = obj(l.message);
  const id = str(m?.id);
  const u = obj(m?.usage);
  if (!m || !id || !u) return null;
  const model = str(m.model) ?? "unknown";
  if (model === "<synthetic>") return null;
  const t = typeof l.timestamp === "string" ? Date.parse(l.timestamp) : Number.NaN;
  if (Number.isNaN(t)) return null;

  // Split cache writes by lifetime; anything the breakdown doesn't cover counts as 5-minute.
  const breakdown = obj(u.cache_creation);
  const cacheWrite1h = n(breakdown?.ephemeral_1h_input_tokens);
  let cacheWrite5m = n(breakdown?.ephemeral_5m_input_tokens);
  const total = n(u.cache_creation_input_tokens);
  if (cacheWrite5m + cacheWrite1h < total) cacheWrite5m = total - cacheWrite1h;

  return {
    id,
    t,
    model,
    session: str(l.sessionId) ?? fallbackSession,
    cwd: str(l.cwd) ?? "",
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite5m,
    cacheWrite1h,
    webSearches: n(obj(u.server_tool_use)?.web_search_requests),
    fast: u.speed === "fast",
    usGeo: u.inference_geo === "us",
    ...toolsOf(m.content),
  };
}

const MAX_TOOLS = 32;
const TOOL_NAME = /^[\w.:-]{1,120}$/;

/** Names of the tools a reply called, in order, without repeats. */
function toolsOf(content: unknown): { tools?: string[] } {
  if (!Array.isArray(content)) return {};
  const names = new Set<string>();
  for (const b of content) {
    const block = obj(b);
    const name = block?.type === "tool_use" ? str(block.name) : undefined;
    if (name && TOOL_NAME.test(name) && names.size < MAX_TOOLS) names.add(name);
  }
  return names.size ? { tools: [...names] } : {};
}

/** Every tool name in either list, first list's order first. */
export function mergeTools(a?: string[], b?: string[]): string[] | undefined {
  if (!b?.length) return a;
  if (!a?.length) return b;
  const all = [...new Set([...a, ...b])].slice(0, MAX_TOOLS);
  return all.length === a.length ? a : all;
}

/**
 * Calls `fn` for the usage on each line of `text` (complete lines only). A cheap substring
 * check skips the vast majority of lines before any JSON is parsed.
 */
export function forEachUsage(
  text: string,
  fallbackSession: string,
  fn: (r: UsageRecord) => void,
): void {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    const o = obj(v);
    const r = o && usageFromObject(o, fallbackSession);
    if (r) fn(r);
  }
}
