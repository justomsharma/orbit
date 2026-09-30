import { describe, expect, it } from "vitest";
import { parseViewMsg } from "../protocol";

describe("setup messages", () => {
  it.each([
    { type: "setup:refresh" },
    { type: "setup:setSetting", scope: "user", key: "theme", value: "dark" },
    { type: "setup:setSetting", scope: "project", key: "effortLevel", value: null },
    { type: "setup:setSetting", scope: "local", key: "cleanupPeriodDays", value: 30 },
    {
      type: "setup:plugin",
      id: "superpowers@claude-plugins-official",
      enabled: false,
      scope: "user",
    },
    { type: "setup:mcpApproval", name: "db", state: "approved" },
    { type: "setup:mcpRemove", scope: "local", name: "db" },
    {
      type: "setup:mcpAdd",
      scope: "user",
      name: "gh",
      transport: "http",
      url: "https://api.x/mcp",
    },
    {
      type: "setup:mcpAdd",
      scope: "project",
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "srv"],
    },
    {
      type: "setup:mcpAdd",
      scope: "local",
      name: "dev",
      transport: "http",
      url: "http://localhost:3000/mcp",
    },
    { type: "setup:mcpLogin", name: "gh" },
    { type: "setup:hookRemove", id: "user:/h/settings.json:Stop:0:0" },
    { type: "setup:hookAdd", scope: "user", event: "Stop", matcher: null, command: "notify.sh" },
    { type: "setup:hooksPaused", paused: true },
    { type: "setup:rule", op: "add", scope: "user", list: "allow", rule: "Bash(npm test)" },
    { type: "setup:skillVisibility", name: "deploy", visibility: "off" },
    {
      type: "setup:new",
      kind: "skill",
      scope: "user",
      name: "release-notes",
      description: "Write notes",
    },
    { type: "setup:open", file: "/h/.claude/settings.json" },
    { type: "setup:createClaudeMd", scope: "project" },
    { type: "setup:fixWithClaude", issueId: "settings-error:user" },
  ])("accepts %j", (m) => {
    expect(parseViewMsg(m)).toEqual(m);
  });

  it.each([
    { type: "setup:setSetting", scope: "managed", key: "theme", value: "dark" },
    { type: "setup:setSetting", scope: "user", key: "theme", value: { nested: true } },
    { type: "setup:setSetting", scope: "user", key: "x".repeat(81), value: 1 },
    { type: "setup:plugin", id: "no-marketplace", enabled: true, scope: "user" },
    { type: "setup:mcpRemove", scope: "plugin", name: "db" },
    { type: "setup:mcpAdd", scope: "user", name: "a b", transport: "stdio", command: "x" },
    {
      type: "setup:mcpAdd",
      scope: "user",
      name: "gh",
      transport: "http",
      url: "javascript:alert(1)",
    },
    {
      type: "setup:mcpAdd",
      scope: "user",
      name: "gh",
      transport: "http",
      url: "file:///etc/passwd",
    },
    { type: "setup:mcpLogin", name: "--help;rm" },
    { type: "setup:hookAdd", scope: "user", event: "Stop", matcher: null, command: "" },
    { type: "setup:rule", op: "add", scope: "user", list: "maybe", rule: "Read" },
    { type: "setup:skillVisibility", name: "deploy", visibility: "hidden" },
    { type: "setup:new", kind: "skill", scope: "managed", name: "x", description: "d" },
    { type: "setup:open", file: "" },
  ])("rejects %j", (m) => {
    expect(parseViewMsg(m)).toBeNull();
  });
});
