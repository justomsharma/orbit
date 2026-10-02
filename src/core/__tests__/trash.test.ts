import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { Trash } from "../trash";

const tmp = useTmpDir();

function setup() {
  const root = tmp();
  const skill = join(root, "skills", "notes");
  mkdirSync(join(skill, "scripts"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: notes\n---\n");
  writeFileSync(join(skill, "scripts", "run.sh"), "echo hi\n");
  const agent = join(root, "agents", "reviewer.md");
  mkdirSync(join(root, "agents"));
  writeFileSync(agent, "agent");
  return { root, skill, agent, trash: new Trash(join(root, "orbit", "trash")) };
}

describe("Trash", () => {
  it("moves a folder out of the way and puts it back exactly", async () => {
    const { skill, trash } = setup();
    const entry = await trash.put(skill, "Deleted skill notes");
    expect(existsSync(skill)).toBe(false);
    expect(readFileSync(join(entry.stored, "scripts", "run.sh"), "utf8")).toBe("echo hi\n");
    await trash.restore(entry.id);
    expect(readFileSync(join(skill, "scripts", "run.sh"), "utf8")).toBe("echo hi\n");
    expect(await trash.list()).toEqual([]);
  });

  it("does the same for a single file, and lists what it holds, newest first", async () => {
    const { skill, agent, trash } = setup();
    const a = await trash.put(agent, "Deleted agent reviewer");
    const b = await trash.put(skill, "Deleted skill notes");
    expect((await trash.list()).map((e) => e.id)).toEqual([b.id, a.id]);
    expect(existsSync(agent)).toBe(false);
    await trash.restore(a.id);
    expect(readFileSync(agent, "utf8")).toBe("agent");
  });

  it("won't put something back over a new one with the same name", async () => {
    const { agent, trash } = setup();
    const e = await trash.put(agent, "Deleted agent reviewer");
    writeFileSync(agent, "a new one");
    await expect(trash.restore(e.id)).rejects.toThrow(/already/);
    expect(readFileSync(agent, "utf8")).toBe("a new one");
    expect((await trash.list()).map((x) => x.id)).toEqual([e.id]);
  });

  it("refuses links and things that aren't there", async (ctx) => {
    const { root, skill, trash } = setup();
    const link = join(root, "skills", "linked");
    try {
      symlinkSync(skill, link, "junction");
    } catch {
      ctx.skip();
    }
    await expect(trash.put(link, "x")).rejects.toThrow(/link/);
    expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
    await expect(trash.put(join(root, "nope"), "x")).rejects.toThrow(/isn't there/);
  });

  it("across drives, rolls back when the original can't be removed, so nothing is half gone", async () => {
    const { root, skill } = setup();
    const exdev = Object.assign(new Error("cross-device"), { code: "EXDEV" });
    let calls = 0;
    const trash = new Trash(join(root, "orbit", "trash"), Date.now, {
      rename: async () => {
        throw exdev;
      },
      // The first removal is of the skill folder: fail it halfway, like an open file.
      removeTree: async (p, real) => {
        calls++;
        if (calls === 1) {
          await real(join(p, "scripts"));
          throw Object.assign(new Error("busy"), { code: "EBUSY" });
        }
        await real(p);
      },
    });
    await expect(trash.put(skill, "Deleted skill notes")).rejects.toThrow(/nothing was deleted/i);
    expect(readFileSync(join(skill, "scripts", "run.sh"), "utf8")).toBe("echo hi\n");
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toContain("notes");
    expect(await trash.list()).toEqual([]);
  });

  it("forgets entries for good only when asked", async () => {
    const { agent, trash } = setup();
    const e = await trash.put(agent, "Deleted agent reviewer");
    await trash.forget(e.id);
    expect(await trash.list()).toEqual([]);
    expect(existsSync(e.stored)).toBe(false);
  });
});
