import { join } from "node:path";
import { stringify } from "yaml";
import { EditError } from "./edits";

export type NewKind = "skill" | "agent" | "command";

/** Lowercase letters, digits and dashes — also rules out any path tricks. */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

function frontmatter(data: Record<string, string>): string {
  return `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n`;
}

const BODY: Record<NewKind, (name: string) => string> = {
  skill: (name) => `
# ${name}

Describe, step by step, how Claude should do this task.

## When to use
- …

## Steps
1. …
`,
  agent: () => `
You are a focused assistant. Describe your role, what to look at, and what to return.

- Be specific about the output format.
- Say which tools to prefer.
`,
  command: () => `
Explain what this command should do. Use $ARGUMENTS for anything typed after the command.
`,
};

/**
 * A new skill, agent or command: where it goes under a `.claude` folder and its
 * starting text. Claude uses the description to decide when to use it.
 */
export function newItem(o: { kind: NewKind; root: string; name: string; description: string }): {
  file: string;
  text: string;
} {
  if (!NAME.test(o.name)) {
    throw new EditError(
      "Use lowercase letters, numbers and dashes for the name (for example release-notes).",
    );
  }
  const description = o.description.trim();
  if (!description)
    throw new EditError("Add a short description: Claude uses it to decide when to use this.");
  const file =
    o.kind === "skill"
      ? join(o.root, "skills", o.name, "SKILL.md")
      : join(o.root, o.kind === "agent" ? "agents" : "commands", `${o.name}.md`);
  const fm =
    o.kind === "command"
      ? frontmatter({ description })
      : frontmatter({ name: o.name, description });
  return { file, text: fm + BODY[o.kind](o.name) };
}
