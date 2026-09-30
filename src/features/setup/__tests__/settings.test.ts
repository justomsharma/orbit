import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { managedSettingsPath, readSettingsFile, readSettingsFiles } from "../settings";
import { put } from "./configFixture";

const tmp = useTmpDir();

describe("managedSettingsPath", () => {
  it("uses each platform's system folder", () => {
    expect(managedSettingsPath("win32")).toBe(
      "C:\\Program Files\\ClaudeCode\\managed-settings.json",
    );
    expect(managedSettingsPath("darwin")).toBe(
      "/Library/Application Support/ClaudeCode/managed-settings.json",
    );
    expect(managedSettingsPath("linux")).toBe("/etc/claude-code/managed-settings.json");
  });
});

describe("readSettingsFiles", () => {
  it("lists user and managed only when no folder is open", async () => {
    const home = tmp();
    const files = await readSettingsFiles(home, null, "linux");
    expect(files.map((f) => f.scope)).toEqual(["user", "managed"]);
    expect(files[0]).toEqual({
      scope: "user",
      path: join(home, "settings.json"),
      exists: false,
      data: null,
      error: null,
    });
    expect(files[1]!.path).toBe("/etc/claude-code/managed-settings.json");
  });

  it("reads every scope that exists", async () => {
    const home = tmp();
    const ws = tmp();
    put(join(home, "settings.json"), { model: "opus", env: { API_KEY: "sk-secret-123" } });
    put(join(ws, ".claude", "settings.json"), { permissions: { allow: ["Bash(npm test)"] } });
    put(join(ws, ".claude", "settings.local.json"), { enabledPlugins: { "a@b": false } });
    const files = await readSettingsFiles(home, ws, "darwin");
    expect(files.map((f) => [f.scope, f.exists, f.error])).toEqual([
      ["user", true, null],
      ["project", true, null],
      ["local", true, null],
      ["managed", false, null],
    ]);
    expect(files[0]!.data).toMatchObject({ model: "opus" });
    expect(files[1]!.path).toBe(join(ws, ".claude", "settings.json"));
    expect(files[1]!.data).toEqual({ permissions: { allow: ["Bash(npm test)"] } });
    expect(files[2]!.path).toBe(join(ws, ".claude", "settings.local.json"));
    expect(files[2]!.data).toEqual({ enabledPlugins: { "a@b": false } });
    expect(files[3]!.path).toBe("/Library/Application Support/ClaudeCode/managed-settings.json");
  });

  it("reports missing project files without an error", async () => {
    const ws = tmp();
    const files = await readSettingsFiles(tmp(), ws, "linux");
    expect(files.filter((f) => f.scope !== "managed")).toEqual([
      { scope: "user", path: expect.any(String), exists: false, data: null, error: null },
      { scope: "project", path: expect.any(String), exists: false, data: null, error: null },
      { scope: "local", path: expect.any(String), exists: false, data: null, error: null },
    ]);
  });

  it("reports JSONC comments, trailing commas and junk without throwing", async () => {
    const home = tmp();
    const ws = tmp();
    put(join(home, "settings.json"), '{\n  // my settings\n  "model": "opus"\n}\n');
    put(join(ws, ".claude", "settings.json"), '{ "model": "opus", }');
    put(join(ws, ".claude", "settings.local.json"), "{ nope");
    const [user, project, local] = await readSettingsFiles(home, ws, "linux");
    expect(user).toMatchObject({ exists: true, data: null });
    expect(user!.error).toBe("Not valid JSON: comments are not allowed (line 2)");
    expect(project!.error).toBe("Not valid JSON: trailing commas are not allowed (line 1)");
    expect(local!.error).toMatch(/^Not valid JSON: /);
    expect(local!.data).toBeNull();
  });

  it("reports a top level that is not an object", async () => {
    const home = tmp();
    const ws = tmp();
    put(join(home, "settings.json"), "[]");
    put(join(ws, ".claude", "settings.json"), '"x"');
    const [user, project] = await readSettingsFiles(home, ws, "linux");
    expect(user).toMatchObject({ exists: true, data: null });
    expect(user!.error).toMatch(/found an array/);
    expect(project!.error).toMatch(/found a string/);
  });

  it("does not read settings over 1 MB", async () => {
    const home = tmp();
    put(join(home, "settings.json"), `{"x":"${"a".repeat(1024 * 1024)}"}`);
    const [user] = await readSettingsFiles(home, null, "linux");
    expect(user).toMatchObject({ exists: true, data: null });
    expect(user!.error).toMatch(/too large/i);
  });
});

describe("readSettingsFile", () => {
  it("reads one file for a given scope (e.g. managed)", async () => {
    const p = put(join(tmp(), "managed-settings.json"), { disableAllHooks: true });
    expect(await readSettingsFile("managed", p)).toEqual({
      scope: "managed",
      path: p,
      exists: true,
      data: { disableAllHooks: true },
      error: null,
    });
  });
});
