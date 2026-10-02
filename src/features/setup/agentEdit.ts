import { isMap, parseDocument } from "yaml";
import { EditError } from "./edits";

/** What Orbit's agent form edits; every other frontmatter field is kept as it is. */
export interface AgentFields {
  name: string;
  description: string;
  /** null: inherit the chat's model (the field is left out). */
  model: string | null;
  /** Empty: every tool (the field is left out). */
  tools: string[];
  skills: string[];
  /** The system prompt: the file's body. */
  prompt: string;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Splits `---\n<yaml>\n---\n<body>`; null frontmatter when the file has none. */
function split(text: string): { yaml: string | null; body: string } {
  const src = text.replace(/^﻿/, "");
  const m = src.match(/^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m);
  if (m?.index !== 0) return { yaml: null, body: src };
  return { yaml: m[1]!, body: src.slice(m[0].length) };
}

/**
 * The agent file for `f`: a new one when `before` is null, otherwise `before`
 * with only the form's fields changed (same order, other fields untouched).
 */
export function agentText(before: string | null, f: AgentFields): string {
  if (!NAME.test(f.name))
    throw new EditError(
      "Use lowercase letters, numbers and dashes for the name (for example code-reviewer).",
    );
  const description = f.description.trim();
  if (!description)
    throw new EditError(
      "Add a short description: Claude uses it to decide when to hand work over.",
    );
  const parts = before === null ? { yaml: "", body: "" } : split(before);
  const doc = parseDocument(parts.yaml ?? "", { keepSourceTokens: false });
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents)))
    throw new EditError(
      "This agent's frontmatter isn't valid YAML, so Orbit won't rewrite it. Fix it in the file first.",
    );
  const put = (key: string, value: unknown) => {
    if (value === null || (Array.isArray(value) && value.length === 0)) doc.delete(key);
    else doc.set(key, value);
  };
  put("name", f.name);
  put("description", description);
  put("model", f.model?.trim() || null);
  put("tools", f.tools.length ? f.tools.join(", ") : null);
  put("skills", f.skills.length ? f.skills : null);
  const yaml = doc.toString({ lineWidth: 0 }).replace(/\n+$/, "\n");
  const prompt = f.prompt.endsWith("\n") || !f.prompt ? f.prompt : `${f.prompt}\n`;
  const out = `---\n${yaml}---\n${prompt}`;
  return before?.includes("\r\n") ? out.replace(/\r?\n/g, "\r\n") : out;
}

/** The same agent file under another name; nothing else changes (not even the body). */
export function renamedAgent(text: string, name: string): string {
  const parts = split(text);
  if (parts.yaml === null) return `---\nname: ${name}\n---\n${text}`;
  const yaml = /^name:[^\r\n]*$/m.test(parts.yaml)
    ? parts.yaml.replace(/^name:[^\r\n]*$/m, `name: ${name}`)
    : `name: ${name}\n${parts.yaml}`;
  return `---\n${yaml}---\n${parts.body}`;
}

/** `name-copy`, `name-copy-2`, … : the first one not in `taken`. */
export function copyName(name: string, taken: Set<string>): string {
  const base = `${name}-copy`.slice(0, 60);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
