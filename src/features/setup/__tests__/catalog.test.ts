import { describe, expect, it } from "vitest";
import { effectiveSetting, settingsCatalog, unknownKeys } from "../catalog";
import type { SettingsFile } from "../settings";

const file = (
  scope: SettingsFile["scope"],
  data: Record<string, unknown> | null,
): SettingsFile => ({
  scope,
  path: `/${scope}.json`,
  exists: data !== null,
  data,
  error: null,
  skipped: null,
});

describe("settingsCatalog", () => {
  const cat = settingsCatalog();
  const byKey = new Map(cat.map((d) => [d.key, d]));

  it("covers Claude Code's official settings with kinds and descriptions", () => {
    expect(cat.length).toBeGreaterThan(100);
    expect(byKey.get("effortLevel")).toMatchObject({ kind: "enum", group: "Model & thinking" });
    expect(byKey.get("effortLevel")!.enum).toContain("high");
    expect(byKey.get("autoMemoryEnabled")).toMatchObject({
      kind: "boolean",
      group: "Memory & context",
    });
    expect(byKey.get("model")!.description.length).toBeGreaterThan(10);
  });

  it("marks organisation-only settings so they are not offered for personal editing", () => {
    expect(byKey.get("allowManagedHooksOnly")?.managedOnly).toBe(true);
    expect(byKey.get("forceLoginMethod")?.managedOnly).toBe(true);
    expect(byKey.get("theme")?.managedOnly).toBe(false);
  });

  it("flags deprecated settings", () => {
    expect(byKey.get("includeCoAuthoredBy")?.deprecated).toBe(true);
  });

  it("puts every setting in a group, most useful groups first", () => {
    expect(cat.every((d) => d.group)).toBe(true);
    expect(cat[0]!.group).toBe("Model & thinking");
    expect(cat.slice(0, 2).map((d) => d.key)).toEqual(["model", "effortLevel"]);
  });
});

describe("effectiveSetting", () => {
  it("returns the value that wins by precedence and where it comes from", () => {
    const files = [
      file("user", { theme: "dark", model: "opus" }),
      file("project", { theme: "light" }),
      file("local", {}),
      file("managed", null),
    ];
    expect(effectiveSetting(files, "theme")).toEqual({ value: "light", scope: "project" });
    expect(effectiveSetting(files, "model")).toEqual({ value: "opus", scope: "user" });
    expect(effectiveSetting(files, "verbose")).toBeNull();
  });

  it("lets managed settings override everything", () => {
    const files = [file("user", { theme: "dark" }), file("managed", { theme: "light" })];
    expect(effectiveSetting(files, "theme")).toEqual({ value: "light", scope: "managed" });
  });
});

describe("unknownKeys", () => {
  it("finds likely typos but ignores $schema", () => {
    expect(
      unknownKeys({ $schema: "x", theme: "dark", thme: "light", effortlevel: "high" }),
    ).toEqual(["effortlevel", "thme"]);
  });
});
