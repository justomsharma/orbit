import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { gitRoot } from "../gitRoot";

const tmp = useTmpDir();

describe("gitRoot", () => {
  it("finds the repository above a subfolder", async () => {
    const repo = join(tmp(), "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "a", "b"), { recursive: true });
    expect(await gitRoot(join(repo, "a", "b"))).toBe(repo);
  });

  it("never resolves a path that isn't absolute against wherever Orbit runs", async () => {
    // A Windows path on Mac/Linux, or a bare name, is not a folder Orbit was given.
    expect(await gitRoot("C:LearningsMakeMyLifeEasy")).toBe(
      process.platform === "win32" ? await gitRoot("C:LearningsMakeMyLifeEasy") : null,
    );
    expect(await gitRoot("src")).toBeNull();
  });
});
