import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { readSkills } from "../skills";
import { linkDir, OVERSIZED, put } from "./helpers";

const tmp = useTmpDir();

function setup() {
  const root = tmp();
  return { home: join(root, "claude"), ws: join(root, "ws"), plug: join(root, "plug") };
}

describe("readSkills", () => {
  it("reads user, project and plugin skills, sorted project → user → plugin", async () => {
    const { home, ws, plug } = setup();
    put(
      home,
      "skills/zeta/SKILL.md",
      "---\nname: zeta\ndescription: Z things\nmodel: opus\nallowed-tools: Read, Grep Bash(git add *)\n---\nDo it\n",
    );
    put(home, "skills/alpha/SKILL.md", "---\nname: alpha\ndescription: A things\n---\n");
    put(
      ws,
      ".claude/skills/deploy/SKILL.md",
      "---\nname: deploy\ndescription: Ships\nallowed-tools: [Bash, Read]\nuser-invocable: false\ndisable-model-invocation: true\n---\n",
    );
    put(plug, "skills/lint/SKILL.md", "---\nname: lint\ndescription: Lints\n---\n");

    const skills = await readSkills(home, ws, [{ id: "tools@market", installPath: plug }]);
    expect(skills.map((s) => [s.scope, s.name])).toEqual([
      ["project", "deploy"],
      ["user", "alpha"],
      ["user", "zeta"],
      ["plugin", "lint"],
    ]);

    const zeta = skills.find((s) => s.name === "zeta")!;
    expect(zeta).toMatchObject({
      description: "Z things",
      scope: "user",
      plugin: null,
      dir: join(home, "skills", "zeta"),
      file: join(home, "skills", "zeta", "SKILL.md"),
      model: "opus",
      allowedTools: ["Read", "Grep", "Bash(git add *)"],
      userInvocable: true,
      modelInvocable: true,
      problems: [],
    });

    const deploy = skills.find((s) => s.name === "deploy")!;
    expect(deploy).toMatchObject({
      allowedTools: ["Bash", "Read"],
      userInvocable: false,
      modelInvocable: false,
      model: null,
    });

    // Plugin skills keep their own name; the plugin is reported separately.
    const lint = skills.find((s) => s.scope === "plugin")!;
    expect(lint.name).toBe("lint");
    expect(lint.plugin).toBe("tools@market");
  });

  it("falls back to the folder name and reports common mistakes", async () => {
    const { home } = setup();
    put(home, "skills/nameless/SKILL.md", "Just instructions\n");
    put(home, "skills/folder/SKILL.md", "---\nname: other\ndescription: d\n---\n");
    put(home, "skills/broken/SKILL.md", '---\nname: "oops\n---\n');

    const skills = await readSkills(home, null, []);
    const by = (n: string) => skills.find((s) => s.dir.endsWith(n))!;
    expect(by("nameless").name).toBe("nameless");
    expect(by("nameless").problems).toEqual(["No description — Claude won't know when to use it"]);
    expect(by("folder").name).toBe("other");
    expect(by("folder").problems).toEqual([
      "Name in SKILL.md (other) differs from its folder (folder)",
    ]);
    expect(by("broken").name).toBe("broken");
    expect(by("broken").problems[0]).toMatch(/^Frontmatter is not valid YAML/);
  });

  it("ignores folders without SKILL.md and stray files", async () => {
    const { home } = setup();
    put(home, "skills/empty/notes.txt", "x");
    put(home, "skills/README.md", "x");
    expect(await readSkills(home, null, [])).toEqual([]);
  });

  it("reports an unreadable SKILL.md instead of dropping it", async () => {
    const { home } = setup();
    put(home, "skills/big/SKILL.md", OVERSIZED);
    const [s] = await readSkills(home, null, []);
    expect(s).toMatchObject({ name: "big", description: null });
    expect(s!.problems).toEqual(["Could not read this file"]);
  });

  it("lists a skill in a linked folder (Claude uses it), marked as linked", async (ctx) => {
    const { home } = setup();
    const outside = join(tmp(), "outside");
    put(outside, "SKILL.md", "---\nname: linked\ndescription: d\n---\n");
    if (!linkDir(outside, join(home, "skills", "linked"))) ctx.skip();
    put(home, "skills/real/SKILL.md", "---\nname: real\ndescription: d\n---\n");
    const skills = await readSkills(home, null, []);
    expect(skills.map((s) => [s.name, s.linked])).toEqual([
      ["linked", true],
      ["real", false],
    ]);
  });

  it("ignores a link that points at nothing or at a file", async (ctx) => {
    const { home } = setup();
    if (!linkDir(join(tmp(), "gone"), join(home, "skills", "dangling"))) ctx.skip();
    put(home, "skills/real/SKILL.md", "---\nname: real\ndescription: d\n---\n");
    expect((await readSkills(home, null, [])).map((s) => s.name)).toEqual(["real"]);
  });

  it("never throws when roots are missing", async () => {
    const { home, ws } = setup();
    expect(await readSkills(home, ws, [{ id: "p@m", installPath: join(ws, "nope") }])).toEqual([]);
    expect(await readSkills(home, null, [{ id: "p@m", installPath: "" }])).toEqual([]);
  });
});
