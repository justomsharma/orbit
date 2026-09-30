import { type JsonObject, obj, str } from "../../core/jsonl";

/** Wrappers Claude Code puts around user lines that the person did not type as a prompt. */
const WRAPPER =
  /^<(command-[a-z-]+|local-command-[a-z-]+|bash-[a-z-]+|system-reminder|task-notification|user-prompt-submit-hook|persisted-output)>/;

export type UserPart =
  | { kind: "text"; text: string }
  | { kind: "image" }
  /** A slash command, e.g. `/review 12`. */
  | { kind: "command"; text: string };

export type AssistantPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input: JsonObject }
  | { kind: "image" };

const blocksOf = (line: JsonObject): unknown[] => {
  const content = obj(line.message)?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
};

function userText(t: string): UserPart | null {
  if (!WRAPPER.test(t)) return { kind: "text", text: t };
  const name = t.match(/<command-name>\s*([^<]*?)\s*<\/command-name>/)?.[1];
  if (!name) return null;
  const args = t
    .match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
  const cmd = name.startsWith("/") ? name : `/${name}`;
  return { kind: "command", text: args ? `${cmd} ${args}` : cmd };
}

/**
 * What the person wrote in a user line, in order. Empty for meta lines, tool
 * results, subagent (sidechain) lines and Claude Code's own wrappers.
 */
export function userParts(line: JsonObject): UserPart[] {
  if (line.type !== "user" || line.isMeta === true || line.isSidechain === true) return [];
  const blocks = blocksOf(line);
  if (blocks.some((b) => obj(b)?.type === "tool_result")) return [];
  const out: UserPart[] = [];
  for (const b of blocks) {
    const o = obj(b);
    if (o?.type === "image") out.push({ kind: "image" });
    if (o?.type !== "text") continue;
    const t = str(o.text)?.trim();
    const part = t ? userText(t) : null;
    if (part) out.push(part);
  }
  return out;
}

/** Text, tool calls and images of an assistant line. Thinking and subagent lines are left out. */
export function assistantParts(line: JsonObject): AssistantPart[] {
  if (line.type !== "assistant" || line.isSidechain === true) return [];
  const out: AssistantPart[] = [];
  for (const b of blocksOf(line)) {
    const o = obj(b);
    if (o?.type === "text") {
      const t = str(o.text)?.trim();
      if (t) out.push({ kind: "text", text: t });
    } else if (o?.type === "tool_use") {
      const name = str(o.name);
      if (name) out.push({ kind: "tool", name, input: obj(o.input) ?? {} });
    } else if (o?.type === "image") out.push({ kind: "image" });
  }
  return out;
}
