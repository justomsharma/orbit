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
