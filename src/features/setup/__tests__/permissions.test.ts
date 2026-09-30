import { describe, expect, it } from "vitest";
import { readPermissions } from "../permissions";
import { settingsOf } from "./configFixture";

describe("readPermissions", () => {
  it("merges rules from every scope, keeping where each came from", () => {
    const p = readPermissions([
      settingsOf("user", {
        env: { API_KEY: "sk-secret-123" },
        permissions: {
          allow: ["Bash(npm test)", "Read(~/notes/**)"],
          deny: ["Read(./.env)"],
          defaultMode: "acceptEdits",
        },
      }),
      settingsOf("project", {
        permissions: { allow: ["Bash(npm run lint)"], ask: ["Bash(git push:*)"] },
      }),
      settingsOf("local", {
        permissions: { allow: ["WebFetch(domain:docs.x.dev)"], additionalDirectories: ["../lib"] },
      }),
      settingsOf("managed", { permissions: { deny: ["Bash(curl:*)"], defaultMode: "default" } }),
    ]);
    expect(p.rules).toEqual([
      { scope: "user", list: "allow", rule: "Bash(npm test)" },
      { scope: "user", list: "allow", rule: "Read(~/notes/**)" },
      { scope: "user", list: "deny", rule: "Read(./.env)" },
      { scope: "project", list: "allow", rule: "Bash(npm run lint)" },
      { scope: "project", list: "ask", rule: "Bash(git push:*)" },
      { scope: "local", list: "allow", rule: "WebFetch(domain:docs.x.dev)" },
      { scope: "managed", list: "deny", rule: "Bash(curl:*)" },
    ]);
    expect(p.defaultMode).toEqual([
      { scope: "user", mode: "acceptEdits" },
      { scope: "managed", mode: "default" },
    ]);
    expect(p.additionalDirectories).toEqual([{ scope: "local", dir: "../lib" }]);
    expect(JSON.stringify(p)).not.toContain("sk-secret-123");
  });

  it("skips non-string rules and odd shapes", () => {
    const p = readPermissions([
      settingsOf("user", {
        permissions: {
          allow: ["Bash(ls)", 42, null, { rule: "x" }],
          ask: "Bash(rm:*)",
          defaultMode: 3,
          additionalDirectories: ["/data", false],
        },
      }),
      settingsOf("project", { permissions: ["Bash(ls)"] }),
      settingsOf("local", { permissions: "allow everything" }),
      settingsOf("managed", null),
    ]);
    expect(p).toEqual({
      rules: [{ scope: "user", list: "allow", rule: "Bash(ls)" }],
      defaultMode: [],
      additionalDirectories: [{ scope: "user", dir: "/data" }],
    });
  });

  it("is empty with no settings", () => {
    expect(readPermissions([])).toEqual({ rules: [], defaultMode: [], additionalDirectories: [] });
  });
});
