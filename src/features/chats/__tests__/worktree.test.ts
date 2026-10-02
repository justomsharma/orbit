import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { worktreeOf } from "../worktree";

const tmp = useTmpDir();

describe("worktreeOf", () => {
  it("spots a worktree Claude Code made, and says when it was removed", async () => {
    const root = tmp();
    const wt = join(root, "shop", ".claude", "worktrees", "fix-cart");
    mkdirSync(wt, { recursive: true });
    expect(await worktreeOf(wt)).toEqual({ kind: "claude", name: "fix-cart", removed: false });
    expect(await worktreeOf(join(root, "shop", ".claude", "worktrees", "gone"))).toEqual({
      kind: "claude",
      name: "gone",
      removed: true,
    });
  });

  it("spots a git worktree by its .git file, and ignores normal checkouts", async () => {
    const root = tmp();
    const wt = join(root, "shop-feature");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".git"), "gitdir: /x/.git/worktrees/shop-feature\n");
    expect(await worktreeOf(wt)).toEqual({ kind: "user", name: "shop-feature", removed: false });
    const repo = join(root, "shop");
    mkdirSync(join(repo, ".git"), { recursive: true });
    expect(await worktreeOf(repo)).toBeNull();
    expect(await worktreeOf("")).toBeNull();
  });
});
