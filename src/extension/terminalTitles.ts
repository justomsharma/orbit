/** VS Code's own placeholders, written literally. */
const SEQUENCE = "$" + "{sequence}";
/** The VS Code settings that decide what a terminal tab shows, and what Orbit sets. */
export const TITLE_SETTINGS: Record<string, unknown> = {
  "terminal.integrated.tabs.title": SEQUENCE,
  "terminal.integrated.tabs.allowAgentCliTitle": false,
};

export interface TitleDeps {
  get(key: string): unknown;
  set(key: string, value: unknown): Promise<void>;
  /** Orbit's own memory of the person's values before it changed them. */
  saved(): Record<string, unknown> | null;
  save(v: Record<string, unknown> | null): Promise<void>;
}

/**
 * Lets Claude Code's own chat names show on terminal tabs, or puts the person's
 * settings back exactly as they were (missing values stay missing).
 */
export async function keepSessionNames(on: boolean, d: TitleDeps): Promise<void> {
  if (on) {
    if (!d.saved()) {
      const before: Record<string, unknown> = {};
      for (const k of Object.keys(TITLE_SETTINGS)) before[k] = d.get(k) ?? null;
      await d.save(before);
    }
    for (const [k, v] of Object.entries(TITLE_SETTINGS)) await d.set(k, v);
    return;
  }
  const before = d.saved();
  if (!before) return;
  for (const k of Object.keys(TITLE_SETTINGS)) await d.set(k, before[k] ?? undefined);
  await d.save(null);
}
