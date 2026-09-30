import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { setSetting } from "../../features/setup/edits";
import { applyJsonEdit, type ConfirmHost } from "../applyEdit";
import { SafeWriter } from "../safeWriter";

const tmp = useTmpDir();

function host(answers: ("apply" | "diff" | "cancel")[]) {
  const log: string[] = [];
  const h: ConfirmHost = {
    confirm: async (summary) => {
      log.push(`confirm ${summary}`);
      return answers.shift() ?? "cancel";
    },
    showDiff: async (plan) => {
      log.push(`diff ${plan.after.includes('"theme": "dark"')}`);
    },
    done: async (message, undo) => {
      log.push(`done ${message}`);
      if (answers[0] === "cancel") return;
      if (undo && answers.shift() === ("undo" as never)) await undo();
    },
    warn: (m) => log.push(`warn ${m}`),
  };
  return { h, log };
}

describe("applyJsonEdit", () => {
  it("asks, applies, and reports with an undo", async () => {
    const d = tmp();
    const f = join(d, "settings.json");
    writeFileSync(f, '{\n  "model": "opus"\n}\n');
    const { h, log } = host(["apply"]);
    const ok = await applyJsonEdit(new SafeWriter(join(d, "b")), h, {
      file: f,
      mutate: setSetting("theme", "dark"),
      summary: "Set theme to dark in your user settings?",
      label: "Theme: dark",
    });
    expect(ok).toBe(true);
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ model: "opus", theme: "dark" });
    expect(log).toEqual(["confirm Set theme to dark in your user settings?", "done Theme: dark"]);
  });

  it("shows the diff first when asked, then asks again", async () => {
    const d = tmp();
    const f = join(d, "settings.json");
    writeFileSync(f, "{}\n");
    const { h, log } = host(["diff", "apply"]);
    await applyJsonEdit(new SafeWriter(join(d, "b")), h, {
      file: f,
      mutate: setSetting("theme", "dark"),
      summary: "Change?",
      label: "Theme",
    });
    expect(log.slice(0, 3)).toEqual(["confirm Change?", "diff true", "confirm Change?"]);
  });

  it("writes nothing when cancelled", async () => {
    const d = tmp();
    const f = join(d, "settings.json");
    writeFileSync(f, "{}\n");
    const { h } = host(["cancel"]);
    const ok = await applyJsonEdit(new SafeWriter(join(d, "b")), h, {
      file: f,
      mutate: setSetting("theme", "dark"),
      summary: "Change?",
      label: "Theme",
    });
    expect(ok).toBe(false);
    expect(readFileSync(f, "utf8")).toBe("{}\n");
  });

  it("explains instead of writing when the file isn't plain JSON", async () => {
    const d = tmp();
    const f = join(d, "settings.json");
    writeFileSync(f, "{ // comment\n}");
    const { h, log } = host(["apply"]);
    const ok = await applyJsonEdit(new SafeWriter(join(d, "b")), h, {
      file: f,
      mutate: setSetting("theme", "dark"),
      summary: "Change?",
      label: "Theme",
    });
    expect(ok).toBe(false);
    expect(log[0]).toMatch(/^warn .*not a plain JSON object/);
  });

  it("re-plans once when Claude rewrote the file after the preview", async () => {
    const d = tmp();
    const f = join(d, "claude.json");
    writeFileSync(f, '{"numStartups": 1}\n');
    let first = true;
    const { h } = host(["apply"]);
    const confirmOnce = h.confirm;
    h.confirm = async (s) => {
      const a = await confirmOnce(s);
      if (first) {
        first = false;
        writeFileSync(f, '{"numStartups": 2}\n'); // Claude writes in between
      }
      return a;
    };
    const ok = await applyJsonEdit(new SafeWriter(join(d, "b")), h, {
      file: f,
      mutate: setSetting("theme", "dark"),
      summary: "Change?",
      label: "Theme",
    });
    expect(ok).toBe(true);
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ numStartups: 2, theme: "dark" });
  });

  describe("undo", () => {
    /** Applies an edit and hands back its Undo action instead of clicking it. */
    async function applied(f: string, d: string, mutate = setSetting("theme", "dark")) {
      let undo: (() => Promise<boolean>) | null = null;
      const log: string[] = [];
      const h: ConfirmHost = {
        confirm: async () => "apply",
        showDiff: async () => {},
        done: async (_l, u) => {
          undo = u;
        },
        warn: (m) => log.push(m),
      };
      const ok = await applyJsonEdit(new SafeWriter(join(d, "b")), h, {
        file: f,
        mutate,
        summary: "Change?",
        label: "Theme",
      });
      expect(ok).toBe(true);
      return { undo: undo as unknown as () => Promise<boolean>, log };
    }

    it("restores the file exactly when nothing changed since", async () => {
      const d = tmp();
      const f = join(d, "settings.json");
      writeFileSync(f, '{\n    "model": "opus"\n}');
      const { undo } = await applied(f, d);
      expect(await undo()).toBe(true);
      expect(readFileSync(f, "utf8")).toBe('{\n    "model": "opus"\n}');
    });

    it("reverses only Orbit's change when Claude rewrote the file since", async () => {
      const d = tmp();
      const f = join(d, "claude.json");
      writeFileSync(f, '{"numStartups": 1}\n');
      const { undo, log } = await applied(f, d);
      writeFileSync(f, '{"numStartups": 2, "theme": "dark", "tips": 3}\n');
      expect(await undo()).toBe(true);
      expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ numStartups: 2, tips: 3 });
      expect(log).toEqual([]);
    });

    it("says it couldn't undo, and changes nothing, when the same value changed again", async () => {
      const d = tmp();
      const f = join(d, "claude.json");
      writeFileSync(f, "{}\n");
      const { undo, log } = await applied(f, d);
      writeFileSync(f, '{"theme": "light"}\n');
      expect(await undo()).toBe(false);
      expect(readFileSync(f, "utf8")).toBe('{"theme": "light"}\n');
      expect(log[0]).toMatch(/Couldn't undo Theme: "theme" changed again/);
    });

    it("doesn't wait for the Undo notice to be dismissed", async () => {
      const d = tmp();
      const f = join(d, "settings.json");
      writeFileSync(f, "{}\n");
      const h: ConfirmHost = {
        confirm: async () => "apply",
        showDiff: async () => {},
        done: () => new Promise(() => {}), // the notice stays open
        warn: () => {},
      };
      const ok = await applyJsonEdit(new SafeWriter(join(d, "b")), h, {
        file: f,
        mutate: setSetting("theme", "dark"),
        summary: "Change?",
        label: "Theme",
      });
      expect(ok).toBe(true);
    });
  });

  it("reports an edit that refuses (e.g. the item changed) without writing", async () => {
    const d = tmp();
    const f = join(d, "s.json");
    writeFileSync(f, '{"permissions": "odd"}');
    const { h, log } = host(["apply"]);
    const ok = await applyJsonEdit(new SafeWriter(join(d, "b")), h, {
      file: f,
      mutate: setSetting("permissions.defaultMode", "plan"),
      summary: "Change?",
      label: "Mode",
    });
    expect(ok).toBe(false);
    expect(log[0]).toMatch(/^warn .*isn't an object/);
  });
});
