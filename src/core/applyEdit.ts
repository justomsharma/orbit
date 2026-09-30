import { ConflictError, type EditPlan, type SafeWriter } from "./safeWriter";

/** Edits a parsed JSON object in place (see features/setup/edits.ts). */
export type Mutate = (o: Record<string, unknown>) => void;

/** The prompts around an edit — injected so the flow is tested without VS Code. */
export interface ConfirmHost {
  /** Modal question; "diff" means the person wants to see the exact change first. */
  confirm(summary: string): Promise<"apply" | "diff" | "cancel">;
  showDiff(plan: EditPlan): Promise<void>;
  /** Success notice with an Undo action. */
  done(label: string, undo: () => Promise<void>): Promise<void>;
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
export async function applyJsonEdit(
  writer: SafeWriter,
  host: ConfirmHost,
  edit: JsonEdit,
): Promise<boolean> {
  let plan: EditPlan;
  try {
    plan = await writer.planJson(edit.file, edit.mutate);
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
      await host.done(edit.label, async () => {
        try {
          await writer.undo(entry.id);
        } catch (e) {
          host.warn(message(e));
        }
      });
      return true;
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt > 1) {
        host.warn(message(e));
        return false;
      }
      try {
        plan = await writer.planJson(edit.file, edit.mutate);
      } catch (e2) {
        host.warn(message(e2));
        return false;
      }
    }
  }
}
