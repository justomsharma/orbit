import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { currentBranch, safeBranch } from "../branch";

const tmp = useTmpDir();

describe("currentBranch", () => {
  it("reads the branch from .git/HEAD, also through a worktree's .git file", async () => {
    const repo = tmp();
    mkdirSync(join(repo, ".git", "worktrees", "wt"), { recursive: true });
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/feature/cart\n");
    expect(await currentBranch(repo)).toBe("feature/cart");
    const wt = join(repo, "wt");
    mkdirSync(wt);
    writeFileSync(join(wt, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "wt")}\n`);
    writeFileSync(join(repo, ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/fix\n");
    expect(await currentBranch(wt)).toBe("fix");
  });

  it("is null for a detached HEAD or a folder that isn't a checkout", async () => {
    const repo = tmp();
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "0123abc\n");
    expect(await currentBranch(repo)).toBeNull();
    expect(await currentBranch(tmp())).toBeNull();
  });
});

describe("safeBranch", () => {
  it.each([
    ["main", true],
    ["feature/cart-v2", true],
    ["--force", false],
    ["a..b", false],
    ["x.lock", false],
    ["has space", false],
    ["$(rm)", false],
  ])("%s → %s", (name, ok) => {
    expect(safeBranch(name)).toBe(ok);
  });
});
