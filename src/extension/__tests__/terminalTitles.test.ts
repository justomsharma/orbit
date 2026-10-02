import { describe, expect, it } from "vitest";
import { keepSessionNames, type TitleDeps } from "../terminalTitles";

/** VS Code's own placeholders, written literally. */
const SEQUENCE = "$" + "{sequence}";
const PROCESS = "$" + "{process}";

function setup(initial: Record<string, unknown>) {
  const settings = new Map(Object.entries(initial));
  let saved: Record<string, unknown> | null = null;
  const d: TitleDeps = {
    get: (k) => settings.get(k),
    set: async (k, v) => {
      if (v === undefined) settings.delete(k);
      else settings.set(k, v);
    },
    saved: () => saved,
    save: async (v) => {
      saved = v;
    },
  };
  return { d, settings };
}

describe("keepSessionNames", () => {
  it("shows Claude's names on tabs, then puts the person's settings back exactly", async () => {
    const { d, settings } = setup({ "terminal.integrated.tabs.title": PROCESS });
    await keepSessionNames(true, d);
    expect(settings.get("terminal.integrated.tabs.title")).toBe(SEQUENCE);
    expect(settings.get("terminal.integrated.tabs.allowAgentCliTitle")).toBe(false);
    await keepSessionNames(true, d);
    await keepSessionNames(false, d);
    expect(Object.fromEntries(settings)).toEqual({
      "terminal.integrated.tabs.title": PROCESS,
    });
  });

  it("does nothing when turned off without having been on", async () => {
    const { d, settings } = setup({ a: 1 });
    await keepSessionNames(false, d);
    expect(Object.fromEntries(settings)).toEqual({ a: 1 });
  });
});
