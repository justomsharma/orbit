import { randomUUID } from "node:crypto";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { L, writeBlob, writeSession } from "../../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { readCheckpoints } from "../reader";

const tmp = useTmpDir();
const H = "0123456789abcdef";
const OTHER = "fedcba9876543210";

function setup() {
  const root = tmp();
  const home = join(root, ".claude");
  const cwd = join(root, "shop");
  mkdirSync(join(cwd, "src"), { recursive: true });
  const id = randomUUID();
  const s = writeSession(
    home,
    cwd,
    (c) => [
      L.user(c, "fix a"),
      L.fileDelta(
        c,
        join("src", "a.ts"),
        { backupFileName: `${H}@v1`, version: 1, realParentDir: join(cwd, "src") },
        "m1",
      ),
    ],
    { id },
  );
  writeFileSync(join(cwd, "src", "a.ts"), "now");
  const read = (transcript: string | null = s.file) =>
    readCheckpoints({ home, sessionId: id, transcript, cwd });
  return { home, cwd, id, read };
}

describe("readCheckpoints", () => {
  it("folds in versions Claude kept that the chat no longer mentions, by their file's hash", async () => {
    const f = setup();
    writeBlob(f.home, f.id, `${H}@v1`, "one");
    const v3 = writeBlob(f.home, f.id, `${H}@v3`, "three!");
    utimesSync(v3, 5000, 5000);
    const { files, orphans } = await f.read();
    expect(orphans).toBe(0);
    expect(files[0]!.versions.map((v) => [v.version, v.bytes, v.available])).toEqual([
      [1, 3, true],
      [3, 6, true],
    ]);
    expect(files[0]!.versions[1]!.at).toBe(5_000_000);
  });

  it("counts backups no file in the chat explains", async () => {
    const f = setup();
    writeBlob(f.home, f.id, `${H}@v1`, "one");
    writeBlob(f.home, f.id, `${OTHER}@v1`, "x");
    writeBlob(f.home, f.id, `${OTHER}@v2`, "y");
    expect((await f.read()).orphans).toBe(2);
  });

  it("still counts the backups when the chat itself is gone", async () => {
    const f = setup();
    writeBlob(f.home, f.id, `${H}@v1`, "one");
    expect(await f.read(null)).toEqual({ files: [], orphans: 1 });
  });

  it("reports a missing backup as 0 bytes, not an error", async () => {
    const f = setup();
    const { files } = await f.read();
    expect(files[0]!.versions[0]).toMatchObject({ version: 1, available: false, bytes: 0 });
  });
});
