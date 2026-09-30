import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { readJsonFile } from "../jsonFile";
import { readMcpServers } from "../mcp";
import { readPlugins } from "../plugins";
import { readSettingsFiles } from "../settings";
import { pluginDir, put, writeInstalled } from "./configFixture";

/**
 * Symbolic links need admin rights on Windows, so the file system is taught a
 * few links here (link path → target) and every test runs on every platform.
 */
const links = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const linkStat = {
    isSymbolicLink: () => true,
    isFile: () => false,
    isDirectory: () => false,
    size: 40,
    mtimeMs: 0,
  };
  const lstat = ((p: string, ...rest: never[]) =>
    links.has(String(p)) ? Promise.resolve(linkStat) : real.lstat(p, ...rest)) as typeof real.lstat;
  const realpath = ((p: string, ...rest: never[]) => {
    const target = links.get(String(p));
    return target === undefined ? real.realpath(p, ...rest) : real.realpath(target);
  }) as typeof real.realpath;
  return { ...real, lstat, realpath, default: { ...real, lstat, realpath } };
});

const tmp = useTmpDir();

/** `link` points at `target`, like a stow or chezmoi dotfile. */
function link(linkPath: string, target: string): string {
  links.set(linkPath, target);
  return linkPath;
}

describe("linked config files", () => {
  it("follows a link to a regular file only when asked", async () => {
    const d = tmp();
    const p = link(join(d, "settings.json"), put(join(d, "dotfiles", "s.json"), { a: 1 }));
    expect(await readJsonFile(p)).toMatchObject({ data: null, error: null, skipped: "link" });
    expect(await readJsonFile(p, { followLinks: true })).toMatchObject({
      exists: true,
      data: { a: 1 },
      error: null,
      skipped: null,
    });
  });

  it("applies the size cap to the link's target", async () => {
    const d = tmp();
    const p = link(join(d, "big.json"), put(join(d, "t.json"), `{"a":"${"x".repeat(2000)}"}`));
    expect(await readJsonFile(p, { maxBytes: 1000, followLinks: true })).toMatchObject({
      data: null,
      error: null,
      skipped: "too-large",
    });
  });

  it("skips a broken link and a link to a folder", async () => {
    const d = tmp();
    mkdirSync(join(d, "folder"));
    const broken = link(join(d, "a.json"), join(d, "gone.json"));
    const folder = link(join(d, "b.json"), join(d, "folder"));
    for (const p of [broken, folder]) {
      expect(await readJsonFile(p, { followLinks: true })).toMatchObject({
        exists: true,
        data: null,
        error: null,
        skipped: "unreadable",
      });
    }
  });

  it("reads linked settings, so plugins turned on there stay on with their parts", async () => {
    const root = tmp();
    const home = join(root, ".claude");
    link(
      join(home, "settings.json"),
      put(join(root, "dotfiles", "settings.json"), {
        model: "opus",
        enabledPlugins: { "sp@official": true },
      }),
    );
    const dir = pluginDir(home, "sp");
    put(join(dir, "skills", "plan", "SKILL.md"), "---\nname: plan\ndescription: Plan\n---\n");
    writeInstalled(home, { "sp@official": [{ scope: "user", installPath: dir }] });

    const settings = await readSettingsFiles(home, null, "linux");
    expect(settings[0]).toMatchObject({ scope: "user", data: { model: "opus" }, error: null });
    const [p] = await readPlugins(home, settings, null, "linux");
    expect(p).toMatchObject({ id: "sp@official", enabled: true, enabledIn: ["user"] });
    expect(p!.counts.skills).toBe(1);
  });

  it("reads a linked ~/.claude.json and a linked .mcp.json", async () => {
    const root = tmp();
    const ws = join(root, "shop");
    const claudeJson = link(
      join(root, ".claude.json"),
      put(join(root, "dotfiles", "claude.json"), { mcpServers: { gh: { url: "https://x.dev" } } }),
    );
    link(
      join(ws, ".mcp.json"),
      put(join(root, "shared", "mcp.json"), { mcpServers: { db: { command: "pg" } } }),
    );
    const servers = await readMcpServers({
      home: join(root, ".claude"),
      claudeJson,
      workspace: ws,
      settings: [],
      plugins: [],
      platform: "linux",
    });
    expect(servers.map((s) => `${s.scope}:${s.name}`)).toEqual(["user:gh", "project:db"]);
  });
});
