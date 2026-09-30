import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { ConflictError, renameWithRetry, SafeWriter, UnparseableError } from "../safeWriter";

const tmp = useTmpDir();

function setup(opts?: ConstructorParameters<typeof SafeWriter>[1]) {
  const d = tmp();
  const backups = join(d, "backups");
  return { d, backups, w: new SafeWriter(backups, opts) };
}

function set(key: string, value: unknown) {
  return (o: Record<string, unknown>) => {
    o[key] = value;
  };
}

function bakFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".bak")) : [];
}

function tmpFiles(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.endsWith(".tmp"));
}

describe("SafeWriter privacy", () => {
  // Settings files often hold API keys in `env`; copies must not be readable by others.
  it.skipIf(process.platform === "win32")(
    "keeps backups and the undo log private to the person (0600, folder 0700)",
    async () => {
      const { d, backups, w } = setup();
      const f = join(d, "settings.json");
      writeFileSync(f, '{"env":{"KEY":"secret"}}', { mode: 0o600 });
      await w.apply(await w.planJson(f, set("a", 1)), "x");
      const mode = (p: string) => statSync(p).mode & 0o777;
      expect(mode(backups)).toBe(0o700);
      for (const b of bakFiles(backups)) expect(mode(join(backups, b))).toBe(0o600);
      expect(mode(join(backups, "undo.json"))).toBe(0o600);
    },
  );
});

describe("SafeWriter.apply", () => {
  it("writes the new text and returns an undo entry", async () => {
    const { d, w } = setup({ now: () => 1000 });
    const f = join(d, "a.txt");
    writeFileSync(f, "old");
    const plan = await w.plan(f, (b) => `${b}+new`);
    expect(plan).toMatchObject({ before: "old", after: "old+new" });
    expect(plan.beforeHash).toMatch(/^[0-9a-f]{64}$/);
    const e = await w.apply(plan, "Add new");
    expect(readFileSync(f, "utf8")).toBe("old+new");
    expect(e).toMatchObject({ file: plan.file, at: 1000, label: "Add new" });
    expect(e.id).toBeTruthy();
    expect(tmpFiles(d)).toEqual([]);
  });

  it("keeps a backup that holds the original bytes", async () => {
    const { d, backups, w } = setup({ now: () => 1234 });
    const f = join(d, "settings.json");
    const original = Buffer.from('﻿{\r\n  "a": "é"  \r\n}\r\n', "utf8");
    writeFileSync(f, original);
    const e = await w.apply(await w.plan(f, () => "{}"), "x");
    expect(e.backup).toBeTruthy();
    expect(readFileSync(e.backup!).equals(original)).toBe(true);
    expect(bakFiles(backups)).toHaveLength(1);
    expect(bakFiles(backups)[0]).toMatch(/^1234-settings\.json-[0-9a-f]{8}\.bak$/);
  });

  it("creates a missing file and its parent directory", async () => {
    const { d, w } = setup();
    const f = join(d, "new", "dir", "x.json");
    const e = await w.apply(await w.plan(f, () => "{}\n"), "create");
    expect(readFileSync(f, "utf8")).toBe("{}\n");
    expect(e.backup).toBeNull();
  });

  it("refuses when the file changed between plan and apply", async () => {
    const { d, backups, w } = setup();
    const f = join(d, "a.txt");
    writeFileSync(f, "v1");
    const plan = await w.plan(f, () => "mine");
    writeFileSync(f, "v2 by someone else");
    await expect(w.apply(plan, "x")).rejects.toBeInstanceOf(ConflictError);
    await expect(w.apply(plan, "x")).rejects.toThrow(/changed since the preview/);
    expect(readFileSync(f, "utf8")).toBe("v2 by someone else");
    expect(bakFiles(backups)).toEqual([]);
    expect(tmpFiles(d)).toEqual([]);
    expect(await w.history()).toEqual([]);
  });

  it("refuses when the file was created since the plan", async () => {
    const { d, w } = setup();
    const f = join(d, "a.txt");
    const plan = await w.plan(f, () => "mine");
    writeFileSync(f, "theirs");
    await expect(w.apply(plan, "x")).rejects.toBeInstanceOf(ConflictError);
    expect(readFileSync(f, "utf8")).toBe("theirs");
  });

  it("refuses when the file was deleted since the plan", async () => {
    const { d, w } = setup();
    const f = join(d, "a.txt");
    writeFileSync(f, "v1");
    const plan = await w.plan(f, () => "mine");
    unlinkSync(f);
    await expect(w.apply(plan, "x")).rejects.toBeInstanceOf(ConflictError);
    expect(existsSync(f)).toBe(false);
  });

  it("writes nothing and records nothing when the text is unchanged", async () => {
    const { d, backups, w } = setup();
    const f = join(d, "a.txt");
    writeFileSync(f, "same");
    const e = await w.apply(await w.plan(f, (b) => b!), "noop");
    expect(e.label).toBe("noop");
    expect(readFileSync(f, "utf8")).toBe("same");
    expect(bakFiles(backups)).toEqual([]);
    expect(await w.history()).toEqual([]);
  });

  it("applies to two different files in parallel", async () => {
    const { d, w } = setup();
    const a = join(d, "a.txt");
    const b = join(d, "b.txt");
    writeFileSync(a, "a");
    writeFileSync(b, "b");
    const [pa, pb] = await Promise.all([w.plan(a, () => "A"), w.plan(b, () => "B")]);
    await Promise.all([w.apply(pa, "a"), w.apply(pb, "b")]);
    expect(readFileSync(a, "utf8")).toBe("A");
    expect(readFileSync(b, "utf8")).toBe("B");
    expect(await w.history()).toHaveLength(2);
  });

  it("lets only the first of two plans on the same file win", async () => {
    const { d, w } = setup();
    const f = join(d, "a.txt");
    writeFileSync(f, "v1");
    const p1 = await w.plan(f, () => "one");
    const p2 = await w.plan(f, () => "two");
    const [r1, r2] = await Promise.allSettled([w.apply(p1, "1"), w.apply(p2, "2")]);
    expect(r1.status).toBe("fulfilled");
    expect(r2.status === "rejected" && r2.reason instanceof ConflictError).toBe(true);
    expect(readFileSync(f, "utf8")).toBe("one");
  });

  it("refuses to edit through a symlink", async (ctx) => {
    const { d, w } = setup();
    const target = join(d, "real.json");
    const link = join(d, "link.json");
    writeFileSync(target, "{}");
    try {
      symlinkSync(target, link);
    } catch {
      ctx.skip();
    }
    await expect(w.plan(link, () => "x")).rejects.toThrow("Refusing to edit a symlink");
    const plan = { file: link, before: "{}", after: "x", beforeHash: null };
    await expect(w.apply(plan, "x")).rejects.toThrow("Refusing to edit a symlink");
    expect(readFileSync(target, "utf8")).toBe("{}");
  });
});

describe("SafeWriter.undo", () => {
  it("restores the exact original bytes", async () => {
    const { d, w } = setup();
    const f = join(d, "s.json");
    const original = Buffer.from('﻿{\r\n  "name": "héllo 🚀"   \r\n}\r\n  ', "utf8");
    writeFileSync(f, original);
    const e = await w.apply(await w.plan(f, () => '{"x":1}'), "x");
    await w.undo(e.id);
    expect(readFileSync(f).equals(original)).toBe(true);
    expect(await w.history()).toEqual([]);
    expect(tmpFiles(d)).toEqual([]);
  });

  it("deletes a file that did not exist before", async () => {
    const { d, w } = setup();
    const f = join(d, "created.json");
    const e = await w.apply(await w.plan(f, () => "{}"), "create");
    await w.undo(e.id);
    expect(existsSync(f)).toBe(false);
  });

  it("refuses after a later external edit and leaves the file alone", async () => {
    const { d, w } = setup();
    const f = join(d, "s.json");
    writeFileSync(f, "v1");
    const e = await w.apply(await w.plan(f, () => "v2"), "x");
    writeFileSync(f, "v3 by the person");
    await expect(w.undo(e.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(w.undo(e.id)).rejects.toThrow(e.backup!);
    expect(readFileSync(f, "utf8")).toBe("v3 by the person");
    expect(await w.history()).toHaveLength(1);
    expect(existsSync(e.backup!)).toBe(true);
  });

  it("refuses when the edited file was deleted afterwards", async () => {
    const { d, w } = setup();
    const f = join(d, "s.json");
    writeFileSync(f, "v1");
    const e = await w.apply(await w.plan(f, () => "v2"), "x");
    unlinkSync(f);
    await expect(w.undo(e.id)).rejects.toBeInstanceOf(ConflictError);
    expect(existsSync(f)).toBe(false);
  });

  it("throws for an unknown id", async () => {
    const { w } = setup();
    await expect(w.undo("nope")).rejects.toThrow(/nope/);
  });
});

describe("SafeWriter.planJson", () => {
  it("refuses text that is not a JSON object", async () => {
    const { d, w } = setup();
    const f = join(d, "s.json");
    for (const text of ["{ // comment\n}", "[1]", "nul"]) {
      writeFileSync(f, text);
      await expect(w.planJson(f, () => {})).rejects.toBeInstanceOf(UnparseableError);
    }
  });

  it("treats a missing, empty or blank file as {}", async () => {
    const { d, w } = setup();
    const f = join(d, "s.json");
    let seen: unknown;
    const p = await w.planJson(f, (o) => {
      seen = { ...o };
      o.a = 1;
    });
    expect(seen).toEqual({});
    expect(p).toMatchObject({ before: null, beforeHash: null, after: '{\n  "a": 1\n}\n' });
    for (const text of ["", "  \n"]) {
      writeFileSync(f, text);
      expect((await w.planJson(f, set("a", 1))).after).toBe('{\n  "a": 1\n}\n');
    }
  });

  it("preserves indentation, trailing newline and key order", async () => {
    const { d, w } = setup();
    const f = join(d, "s.json");
    writeFileSync(f, '{\n    "z": 1,\n    "a": 2\n}\n');
    expect((await w.planJson(f, set("m", 3))).after).toBe(
      '{\n    "z": 1,\n    "a": 2,\n    "m": 3\n}\n',
    );
    writeFileSync(f, '{\n\t"z": 1\n}');
    expect((await w.planJson(f, set("z", 2))).after).toBe('{\n\t"z": 2\n}');
  });

  it("round-trips through apply", async () => {
    const { d, w } = setup();
    const f = join(d, "s.json");
    writeFileSync(f, '{\r\n  "a": 1\r\n}\r\n');
    await w.apply(await w.planJson(f, set("b", true)), "b");
    expect(readFileSync(f, "utf8")).toBe('{\r\n  "a": 1,\r\n  "b": true\r\n}\r\n');
  });
});

describe("SafeWriter.history", () => {
  it("lists newest first and persists across instances", async () => {
    let t = 0;
    const { d, backups, w } = setup({ now: () => ++t });
    const f = join(d, "a.txt");
    writeFileSync(f, "0");
    for (const n of ["1", "2", "3"]) await w.apply(await w.plan(f, () => n), `set ${n}`);
    const again = new SafeWriter(backups);
    expect((await again.history()).map((e) => e.label)).toEqual(["set 3", "set 2", "set 1"]);
    expect(existsSync(join(backups, "undo.json"))).toBe(true);
  });

  it("drops the oldest entries and their backups past maxEntries", async () => {
    let t = 0;
    const { d, backups, w } = setup({ now: () => ++t, maxEntries: 2 });
    const f = join(d, "a.txt");
    writeFileSync(f, "0");
    const entries = [];
    for (const n of ["1", "2", "3"]) entries.push(await w.apply(await w.plan(f, () => n), n));
    expect((await w.history()).map((e) => e.label)).toEqual(["3", "2"]);
    expect(existsSync(entries[0]!.backup!)).toBe(false);
    expect(existsSync(entries[1]!.backup!)).toBe(true);
    expect(bakFiles(backups)).toHaveLength(2);
  });

  it("treats a corrupt undo log as empty", async () => {
    const { backups, w } = setup();
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, "undo.json"), "{oops");
    expect(await w.history()).toEqual([]);
  });
});

describe("renameWithRetry", () => {
  function busy(code: string) {
    return Object.assign(new Error(code), { code });
  }

  it("retries while Windows holds the file open", async () => {
    let calls = 0;
    await renameWithRetry("a", "b", async () => {
      calls++;
      if (calls < 3) throw busy("EPERM");
    });
    expect(calls).toBe(3);
  });

  it("gives up after 5 retries", async () => {
    let calls = 0;
    const p = renameWithRetry("a", "b", async () => {
      calls++;
      throw busy("EBUSY");
    });
    await expect(p).rejects.toThrow("EBUSY");
    expect(calls).toBe(6);
  });

  it("does not retry other errors", async () => {
    let calls = 0;
    const p = renameWithRetry("a", "b", async () => {
      calls++;
      throw busy("ENOENT");
    });
    await expect(p).rejects.toThrow("ENOENT");
    expect(calls).toBe(1);
  });
});
