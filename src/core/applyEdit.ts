import { parseJsonObject } from "./json";
import { ReverseConflict, reverseJsonEdit } from "./jsonReverse";
import { ConflictError, type EditPlan, type SafeWriter } from "./safeWriter";

/** Edits a parsed JSON object in place (see features/setup/edits.ts). */
export type Mutate = (o: Record<string, unknown>) => void;

/** The prompts around an edit — injected so the flow is tested without VS Code. */
export interface ConfirmHost {
  /** Modal question; "diff" means the person wants to see the exact change first. */
  confirm(summary: string): Promise<"apply" | "diff" | "cancel">;
  showDiff(plan: EditPlan): Promise<void>;
  /** Success notice with an Undo action; `undo` resolves to whether it worked. Not awaited. */
  done(label: string, undo: () => Promise<boolean>): Promise<void>;
  warn(message: string): void;
}

export interface JsonEdit {
  file: string;
  mutate: Mutate;
  /** Plain-language question, e.g. "Turn off the github plugin in your user settings?" */
  summary: string;
  /** Short name for the change in history and the Undo notice. */
  label: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Preview → confirm → backup + atomic write → Undo. If Claude rewrote the file
 * between the preview and the write (common for ~/.claude.json), the same edit is
 * planned again on the fresh file once; Claude's own change is never lost.
 */
export function applyJsonEdit(
  writer: SafeWriter,
  host: ConfirmHost,
  edit: JsonEdit,
): Promise<boolean> {
  return applyPlanned(
    writer,
    host,
    () => writer.planJson(edit.file, edit.mutate),
    edit,
    (plan) => {
      const before =
        plan.before === null || plan.before.trim() === "" ? {} : parseJsonObject(plan.before);
      const after = parseJsonObject(plan.after);
      return before && after ? reverseJsonEdit(before, after) : null;
    },
  );
}

export interface TextEdit {
  file: string;
  /** New content from the current one (null when the file doesn't exist). May throw to refuse. */
  transform: (before: string | null) => string;
  summary: string;
  label: string;
}

/** The same flow for a whole-file edit, such as creating a new skill. */
export function applyTextEdit(
  writer: SafeWriter,
  host: ConfirmHost,
  edit: TextEdit,
): Promise<boolean> {
  return applyPlanned(writer, host, () => writer.plan(edit.file, edit.transform), edit);
}

async function applyPlanned(
  writer: SafeWriter,
  host: ConfirmHost,
  makePlan: () => Promise<EditPlan>,
  edit: { summary: string; label: string },
  /** For JSON files: the inverse change, used when the file changed after Orbit's edit. */
  reverseOf?: (plan: EditPlan) => Mutate | null,
): Promise<boolean> {
  let plan: EditPlan;
  try {
    plan = await makePlan();
  } catch (e) {
    host.warn(message(e));
    return false;
  }
  if (plan.after === plan.before) return true;

  for (;;) {
    const answer = await host.confirm(edit.summary);
    if (answer === "diff") {
      await host.showDiff(plan);
      continue;
    }
    if (answer !== "apply") return false;
    break;
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const entry = await writer.apply(plan, edit.label);
      const applied = plan;
      const undo = async (): Promise<boolean> => {
        try {
          await writer.undo(entry.id);
          return true;
        } catch (e) {
          const reverse = e instanceof ConflictError ? reverseOf?.(applied) : null;
          if (!reverse) {
            host.warn(`Couldn't undo ${edit.label}: ${message(e)}`);
            return false;
          }
          return undoByReversing(writer, host, applied.file, reverse, edit.label);
        }
      };
      // The notice stays until dismissed; the edit is done, so don't wait for it.
      void host.done(edit.label, undo).catch(() => {});
      return true;
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt > 1) {
        host.warn(message(e));
        return false;
      }
      try {
        plan = await makePlan();
      } catch (e2) {
        host.warn(message(e2));
        return false;
      }
    }
  }
}

/** Undo for a JSON file Claude rewrote after Orbit's edit: put back only Orbit's values. */
async function undoByReversing(
  writer: SafeWriter,
  host: ConfirmHost,
  file: string,
  reverse: Mutate,
  label: string,
): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      const plan = await writer.planJson(file, reverse);
      if (plan.after !== plan.before) await writer.apply(plan, `Undo: ${label}`);
      return true;
    } catch (e) {
      if (e instanceof ConflictError && attempt === 1) continue;
      const why = e instanceof ReverseConflict ? `${e.message} Nothing was changed.` : message(e);
      host.warn(`Couldn't undo ${label}: ${why}`);
      return false;
    }
  }
}
