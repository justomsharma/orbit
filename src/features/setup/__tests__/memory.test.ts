import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { listMemoryProjects, managedClaudeMdPath, readMemory, readMemoryDir } from "../memory";
import { OVERSIZED, put } from "./helpers";

const tmp = useTmpDir();

function setup() {
  const root = tmp();
  const userHome = join(root, "u");
  return { root, userHome, home: join(userHome, ".claude"), ws: join(root, "ws") };
}

const slug = (p: string) => p.replace(/[^a-zA-Z0-9]/g, "-");

describe("readMemory — CLAUDE.md files", () => {
  it("lists every candidate with exists flags and resolves imports", async () => {
    const { userHome, home, ws } = setup();
    put(userHome, "shared/rules.md", "rules");
    const userMd = put(
      home,
      "CLAUDE.md",
      [
        "# Me",
        "Always follow @~/shared/rules.md and @missing.md.",
        "Mail me at a@b.com or ping @",
        "```",
        "@inside-fence.md",
        "```",
        "Inline `@in-code.md` is ignored too.",
        "@~/shared/rules.md again",
      ].join("\n"),
    );
    put(ws, "docs/guide.md", "guide");
    put(ws, "CLAUDE.md", "See @docs/guide.md\r\n");

    const m = await readMemory({ home, workspace: ws, settings: {}, platform: "linux", userHome });
    expect(m.claudeMd.map((f) => [f.scope, f.exists])).toEqual([
      ["user", true],
      ["project", true],
      ["project-dir", false],
      ["local", false],
      ["managed", false],
    ]);
    const user = m.claudeMd[0]!;
    expect(user.path).toBe(userMd);
    expect(user.bytes).toBeGreaterThan(0);
    expect(user.imports).toEqual([
      { ref: "~/shared/rules.md", path: join(userHome, "shared", "rules.md"), exists: true },
      { ref: "missing.md", path: join(home, "missing.md"), exists: false },
    ]);
    expect(m.claudeMd[1]!.imports).toEqual([
      { ref: "docs/guide.md", path: join(ws, "docs", "guide.md"), exists: true },
    ]);
    expect(m.claudeMd[2]).toMatchObject({
      path: join(ws, ".claude", "CLAUDE.md"),
      bytes: 0,
      imports: [],
    });
    expect(m.claudeMd[3]!.path).toBe(join(ws, "CLAUDE.local.md"));
    expect(m.claudeMd[4]!.path).toBe("/etc/claude-code/CLAUDE.md");
  });

  it("uses the right managed path per platform", () => {
    expect(managedClaudeMdPath("win32")).toBe("C:\\Program Files\\ClaudeCode\\CLAUDE.md");
    expect(managedClaudeMdPath("darwin")).toBe("/Library/Application Support/ClaudeCode/CLAUDE.md");
    expect(managedClaudeMdPath("linux")).toBe("/etc/claude-code/CLAUDE.md");
  });

  it("without a workspace lists only the user and managed files", async () => {
    const { userHome, home } = setup();
    const m = await readMemory({ home, workspace: null, settings: {}, userHome });
    expect(m.claudeMd.map((f) => f.scope)).toEqual(["user", "managed"]);
    expect(m.auto).toEqual({
      enabled: true,
      dir: "",
      indexPath: null,
      indexLines: 0,
      indexBytes: 0,
      files: [],
    });
  });

  it("keeps an oversized CLAUDE.md as existing", async () => {
    const { userHome, home } = setup();
    put(home, "CLAUDE.md", OVERSIZED);
    const m = await readMemory({ home, workspace: null, settings: {}, userHome });
    expect(m.claudeMd[0]).toMatchObject({ exists: true, imports: [] });
    expect(m.claudeMd[0]!.bytes).toBeGreaterThan(256 * 1024);
  });
});

describe("readMemory — auto memory", () => {
  it("reads memories with links, broken links, orphans and the index size", async () => {
    const { userHome, home, ws } = setup();
    const dir = join(home, "projects", slug(ws), "memory");
    const index = put(
      dir,
      "MEMORY.md",
      "# Memory\n- [User role](user_role.md) — who I am\n- [[by-stem]]\n",
    );
    put(
      dir,
      "user_role.md",
      "---\nname: user-role\ndescription: Who I am\n---\nSee [[testing]], [[by-stem|alias]] and [[ghost]].\n",
    );
    put(dir, "feedback_testing.md", "---\nname: testing\ndescription: How to test\n---\nx\n");
    put(dir, "by-stem.md", "No frontmatter, links back to [[user-role]].\n");
    put(dir, "lonely.md", "Nobody links here. [[lonely]]\n");
    put(dir, "notes.txt", "ignored");

    const m = await readMemory({ home, workspace: ws, settings: {}, userHome });
    expect(m.auto).toMatchObject({ enabled: true, dir, indexPath: index, indexLines: 3 });
    expect(m.auto.indexBytes).toBe(
      Buffer.byteLength("# Memory\n- [User role](user_role.md) — who I am\n- [[by-stem]]\n"),
    );
    const by = (n: string) => m.auto.files.find((f) => f.name === n)!;
    expect(m.auto.files.map((f) => f.name)).toEqual([
      "by-stem.md",
      "feedback_testing.md",
      "lonely.md",
      "user_role.md",
    ]);
    expect(by("user_role.md")).toMatchObject({
      path: join(dir, "user_role.md"),
      title: "user-role",
      description: "Who I am",
      links: ["testing", "by-stem", "ghost"],
      brokenLinks: ["ghost"],
      orphan: false,
    });
    expect(by("user_role.md").bytes).toBeGreaterThan(0);
    expect(by("feedback_testing.md")).toMatchObject({ title: "testing", orphan: false });
    expect(by("by-stem.md")).toMatchObject({
      title: "by-stem",
      description: null,
      links: ["user-role"],
      brokenLinks: [],
      orphan: false,
    });
    // A memory that only links to itself is still an orphan.
    expect(by("lonely.md")).toMatchObject({ orphan: true, brokenLinks: [] });
  });

  it("knows each memory's type, who links to it, its index line and when it changed", async () => {
    const { userHome, home, ws } = setup();
    const dir = join(home, "projects", slug(ws), "memory");
    put(dir, "MEMORY.md", "# Memory\n- [Role](role.md) — who I am\n");
    put(dir, "role.md", "---\nname: role\ndescription: Who\nmetadata:\n  type: user\n---\nx\n");
    put(dir, "tests.md", "---\nname: tests\ntype: feedback\n---\nSee [[role]].\n");
    put(dir, "plain.md", "No frontmatter here.\n");
    const m = await readMemory({ home, workspace: ws, settings: {}, userHome });
    const by = (n: string) => m.auto.files.find((f) => f.name === n)!;
    expect(by("role.md")).toMatchObject({
      type: "user",
      linksIn: ["tests"],
      indexEntry: "- [Role](role.md) — who I am",
      frontmatter: true,
    });
    expect(by("tests.md")).toMatchObject({ type: "feedback", linksIn: [], indexEntry: null });
    expect(by("plain.md")).toMatchObject({ type: null, frontmatter: false });
    expect(by("role.md").modified).toBeGreaterThan(0);
  });

  it("counts every line of a long index", async () => {
    const { userHome, home, ws } = setup();
    const dir = join(home, "projects", slug(ws), "memory");
    put(dir, "MEMORY.md", Array.from({ length: 250 }, (_, i) => `- line ${i}`).join("\n"));
    const m = await readMemory({ home, workspace: ws, settings: {}, userHome });
    expect(m.auto.indexLines).toBe(250);
    expect(m.auto.files).toEqual([]);
  });

  it("builds the folder slug from the workspace path", async () => {
    const { userHome, home } = setup();
    const m = await readMemory({
      home,
      workspace: "C:\\Learnings\\MakeMyLifeEasy",
      settings: {},
      userHome,
    });
    expect(m.auto.dir).toBe(join(home, "projects", "C--Learnings-MakeMyLifeEasy", "memory"));
    expect(m.auto.indexPath).toBeNull();
  });

  describe("follows the git repository, as Claude does", () => {
    it("uses the repository root when a subfolder is open", async () => {
      const { root, userHome, home } = setup();
      const repo = join(root, "repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      mkdirSync(join(repo, "packages", "web"), { recursive: true });
      const m = await readMemory({
        home,
        workspace: join(repo, "packages", "web"),
        settings: {},
        userHome,
      });
      expect(m.auto.dir).toBe(join(home, "projects", slug(repo), "memory"));
    });

    it("shares the main checkout's folder from a git worktree", async () => {
      const { root, userHome, home } = setup();
      const repo = join(root, "repo");
      const wt = join(root, "wt-feature");
      const gitdir = join(repo, ".git", "worktrees", "wt-feature");
      mkdirSync(gitdir, { recursive: true });
      mkdirSync(wt, { recursive: true });
      writeFileSync(join(wt, ".git"), `gitdir: ${gitdir}\n`);
      writeFileSync(join(gitdir, "commondir"), "../..\n");
      const m = await readMemory({ home, workspace: wt, settings: {}, userHome });
      expect(m.auto.dir).toBe(join(home, "projects", slug(repo), "memory"));
    });

    it("keeps the folder itself outside a repository", async () => {
      const { userHome, home, ws } = setup();
      mkdirSync(ws, { recursive: true });
      const m = await readMemory({ home, workspace: ws, settings: {}, userHome });
      expect(m.auto.dir).toBe(join(home, "projects", slug(ws), "memory"));
    });
  });

  it("uses autoMemoryDirectory with ~ expanded", async () => {
    const { userHome, home, ws } = setup();
    put(userHome, "mem/a.md", "---\nname: a\n---\n");
    const m = await readMemory({
      home,
      workspace: ws,
      settings: { autoMemoryDirectory: "~/mem" },
      userHome,
    });
    expect(m.auto.dir).toBe(join(userHome, "mem"));
    expect(m.auto.files.map((f) => f.title)).toEqual(["a"]);
    // No index at all: every memory is an orphan.
    expect(m.auto.files[0]!.orphan).toBe(true);
  });

  it("reports auto memory as disabled but still shows its files", async () => {
    const { userHome, home, ws } = setup();
    put(join(home, "projects", slug(ws), "memory"), "a.md", "x");
    const m = await readMemory({
      home,
      workspace: ws,
      settings: { autoMemoryEnabled: false, autoMemoryDirectory: 42 },
      userHome,
    });
    expect(m.auto.enabled).toBe(false);
    expect(m.auto.dir).toBe(join(home, "projects", slug(ws), "memory"));
    expect(m.auto.files).toHaveLength(1);
  });

  it("keeps an unreadable memory file", async () => {
    const { userHome, home, ws } = setup();
    put(join(home, "projects", slug(ws), "memory"), "big.md", OVERSIZED);
    const m = await readMemory({ home, workspace: ws, settings: {}, userHome });
    expect(m.auto.files).toEqual([
      expect.objectContaining({ name: "big.md", title: "big", links: [], orphan: true }),
    ]);
  });

  it("never throws when nothing exists", async () => {
    const { root } = setup();
    const m = await readMemory({
      home: join(root, "nope"),
      workspace: join(root, "nope-ws"),
      settings: { autoMemoryEnabled: "yes", autoMemoryDirectory: "" },
    });
    expect(m.claudeMd.every((f) => !f.exists || f.scope === "managed")).toBe(true);
    expect(m.auto.files).toEqual([]);
    expect(m.auto.enabled).toBe(true);
  });
});

describe("memories of other projects", () => {
  it("lists every project folder that has memories, with how many", async () => {
    const { home } = setup();
    put(home, "projects/C--code-shop/memory/a.md", "a");
    put(home, "projects/C--code-shop/memory/MEMORY.md", "index");
    put(home, "projects/C--code-api/memory/b.md", "b");
    put(home, "projects/C--code-api/memory/c.md", "c");
    put(home, "projects/C--empty/x.jsonl", "{}");
    expect(await listMemoryProjects(home)).toEqual([
      { slug: "C--code-api", dir: join(home, "projects", "C--code-api", "memory"), count: 2 },
      { slug: "C--code-shop", dir: join(home, "projects", "C--code-shop", "memory"), count: 1 },
    ]);
  });

  it("reads one project's memories like this project's", async () => {
    const { home } = setup();
    const dir = put(home, "projects/C--code-api/memory/b.md", "---\nname: b\n---\n").replace(
      /[\\/]b\.md$/,
      "",
    );
    const files = await readMemoryDir(dir);
    expect(files.map((f) => f.title)).toEqual(["b"]);
  });
});
