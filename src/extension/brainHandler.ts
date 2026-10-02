import { readFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import type { ConfirmHost } from "../core/applyEdit";
import { parseJsonObject } from "../core/json";
import type { SafeWriter, UndoEntry } from "../core/safeWriter";
import { unzip, zip } from "../core/zip";
import {
  type BrainPart,
  type BrainScope,
  collectBrain,
  planImport,
  readBrain,
} from "../features/brain/brain";

export interface BrainDeps {
  home: string;
  claudeJson: string;
  workspace(): string | null;
  writer: SafeWriter;
  confirm: ConfirmHost;
  /** What to export: yours, this project's, or both. Null when cancelled. */
  pickScope(): Promise<BrainScope | null>;
  /** Which parts of a backup to bring in. Null when cancelled. */
  pickParts(has: BrainPart[]): Promise<BrainPart[] | null>;
  saveZip(name: string, bytes: Buffer): Promise<string | null>;
  openZip(): Promise<Buffer | null>;
  info(message: string): void;
  refresh(): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * What an imported file becomes. Settings merge (yours kept where the backup has
 * nothing, your `env` always kept, since backups leave it out); a project's
 * .mcp.json adds only servers you don't have. Other files are replaced.
 */
function merged(name: string, text: string, before: string | null): string {
  if (before === null) return text;
  const mine = parseJsonObject(before);
  const theirs = parseJsonObject(text);
  if (!mine || !theirs) return text;
  if (name.endsWith("settings.json")) {
    const out: Obj = { ...mine, ...theirs };
    if ("env" in mine) out.env = mine.env;
    else delete out.env;
    return `${JSON.stringify(out, null, 2)}\n`;
  }
  if (name === "project/.mcp.json") {
    const servers: Obj = { ...(isObj(theirs.mcpServers) ? theirs.mcpServers : {}) };
    const own = isObj(mine.mcpServers) ? mine.mcpServers : {};
    return `${JSON.stringify({ ...theirs, ...mine, mcpServers: { ...servers, ...own } }, null, 2)}\n`;
  }
  return text;
}
const list = (xs: string[], n = 5) =>
  xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.join(", ");

export async function exportBrain(d: BrainDeps): Promise<void> {
  const scope = await d.pickScope();
  if (!scope) return;
  const b = await collectBrain({
    home: d.home,
    claudeJson: d.claudeJson,
    workspace: d.workspace(),
    scope,
  });
  if (b.entries.length <= 1) {
    d.confirm.warn("There's nothing to back up there yet.");
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  const saved = await d.saveZip(`claude-brain-${day}.claudebrain.zip`, zip(b.entries));
  if (!saved) return;
  d.info(
    `Saved your brain (${b.entries.length - 1} files) to ${basename(saved)}.${b.left.length ? ` Left out: ${list(b.left, 3)}.` : ""}`,
  );
}

export async function importBrain(d: BrainDeps): Promise<void> {
  const bytes = await d.openZip();
  if (!bytes) return;
  let brain: ReturnType<typeof readBrain>;
  try {
    brain = readBrain(unzip(bytes));
  } catch (e) {
    d.confirm.warn(
      e instanceof Error && /brain|safe/.test(e.message)
        ? e.message
        : "Orbit couldn't read that file as a brain backup.",
    );
    return;
  }
  const has = (["user", "project"] as const).filter(
    (p) =>
      brain.files.some((f) => f.name.startsWith(`${p}/`)) ||
      (p === "user" && Object.keys(brain.mcpServers).length),
  );
  if (!has.length) {
    d.confirm.warn("That backup is empty.");
    return;
  }
  const parts = await d.pickParts([...has]);
  if (!parts?.length) return;
  const plan = planImport(brain, { home: d.home, workspace: d.workspace() }, parts);
  for (const s of plan.skipped) d.info(s);

  // MCP servers: only ones you don't have yet are added; yours stay as they are.
  let current: Obj = {};
  try {
    const o = parseJsonObject(await readFile(d.claudeJson, "utf8"));
    if (o && isObj(o.mcpServers)) current = o.mcpServers;
  } catch {}
  const kept = Object.keys(plan.mcpServers).filter((n) => Object.hasOwn(current, n));
  const added = Object.keys(plan.mcpServers).filter((n) => !kept.includes(n));
  const items = plan.files.length + added.length;
  if (!items) {
    d.info(`Nothing new to import${kept.length ? `; kept your own: ${list(kept)}` : ""}.`);
    return;
  }
  const shown = (f: { name: string; target: string }) =>
    f.name.startsWith("user/")
      ? `~/.claude/${relative(d.home, f.target).split("\\").join("/")}`
      : f.name.slice("project/".length);
  const replaced = plan.files.filter((f) => f.exists).map(shown);
  const answer = await d.confirm.confirm(
    `Import ${items} item${items === 1 ? "" : "s"} from this backup? Orbit backs up anything it changes, and one Undo puts it all back.`,
    [
      replaced.length ? `Replaces ${replaced.length}: ${list(replaced)}.` : "",
      "Skills, hooks and MCP servers run on your computer: only import backups you made or trust.",
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (answer !== "apply") return;

  const done: UndoEntry[] = [];
  const failed: string[] = [];
  for (const f of plan.files) {
    try {
      const p = await d.writer.plan(f.target, (before) => merged(f.name, f.text, before));
      done.push(await d.writer.apply(p, `Imported ${f.name}`));
    } catch (e) {
      failed.push(`${f.name}: ${message(e)}`);
    }
  }
  if (added.length) {
    // Planned now, after the question: Claude rewrites ~/.claude.json often.
    try {
      const mcpPlan = await d.writer.planJson(d.claudeJson, (o) => {
        if (!isObj(o.mcpServers)) o.mcpServers = {};
        const servers = o.mcpServers as Obj;
        for (const [name, s] of Object.entries(plan.mcpServers))
          if (!Object.hasOwn(servers, name)) servers[name] = s;
      });
      done.push(await d.writer.apply(mcpPlan, "Imported MCP servers"));
    } catch (e) {
      failed.push(`MCP servers: ${message(e)}`);
    }
  }
  await d.refresh();
  if (failed.length) d.confirm.warn(`Some items weren't imported: ${list(failed, 3)}`);
  const extra = [
    kept.length ? `kept your own: ${list(kept)}` : "",
    brain.leftOut.some((l) => /MCP|secret/i.test(l)) ? "fill in MCP keys again" : "",
  ]
    .filter(Boolean)
    .join("; ");
  void d.confirm.done(
    `Imported ${done.length} item${done.length === 1 ? "" : "s"}${extra ? ` (${extra})` : ""}`,
    async () => {
      let ok = true;
      for (const e of [...done].reverse()) {
        try {
          await d.writer.undo(e.id);
        } catch {
          ok = false;
        }
      }
      await d.refresh();
      return ok;
    },
  );
}
