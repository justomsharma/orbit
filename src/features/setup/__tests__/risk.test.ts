import { describe, expect, it } from "vitest";
import { MODE_LABELS, riskWarning } from "../risk";

describe("riskWarning", () => {
  it("warns in plain words before bypassing every permission check", () => {
    expect(riskWarning("permissions.defaultMode", "bypassPermissions", "user")).toMatch(
      /without asking.*every project.*sandbox/s,
    );
    expect(riskWarning("permissions.defaultMode", "bypassPermissions", "local")).toMatch(
      /in this folder/,
    );
  });

  it("warns before auto-approving every project's MCP servers", () => {
    expect(riskWarning("enableAllProjectMcpServers", true, "user")).toMatch(/clone/);
  });

  it("warns before turning off Claude's own safety prompts", () => {
    expect(riskWarning("skipDangerousModePermissionPrompt", true, "user")).toMatch(/warning/);
    expect(riskWarning("skipWebFetchPreflight", true, "user")).toMatch(/blocklist/);
  });

  it("stays quiet for safe choices and for turning risky ones off", () => {
    expect(riskWarning("permissions.defaultMode", "plan", "user")).toBeNull();
    expect(riskWarning("enableAllProjectMcpServers", false, "user")).toBeNull();
    expect(riskWarning("enableAllProjectMcpServers", null, "user")).toBeNull();
    expect(riskWarning("theme", "dark", "user")).toBeNull();
  });

  it("has a friendly name for every permission mode", () => {
    expect(Object.keys(MODE_LABELS)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "dontAsk",
      "bypassPermissions",
    ]);
  });
});

describe("riskWarning for Config's quick settings", () => {
  it("warns before Claude deletes chats sooner than its 30-day default", () => {
    expect(riskWarning("cleanupPeriodDays", 3, "user")).toMatch(
      /delete.*3 days.*can't bring them back/s,
    );
    expect(riskWarning("cleanupPeriodDays", 90, "user")).toBeNull();
    expect(riskWarning("cleanupPeriodDays", null, "user")).toBeNull();
  });

  it("warns before turning off the sandbox or the bypass block", () => {
    expect(riskWarning("sandbox.enabled", null, "user")).toMatch(/files and network/);
    expect(riskWarning("sandbox.enabled", false, "user")).toMatch(/files and network/);
    expect(riskWarning("sandbox.enabled", true, "user")).toBeNull();
    expect(riskWarning("permissions.disableBypassPermissionsMode", null, "user")).toMatch(/bypass/);
    expect(riskWarning("permissions.disableBypassPermissionsMode", "disable", "user")).toBeNull();
  });

  it("warns before modes that act without asking", () => {
    expect(riskWarning("permissions.defaultMode", "acceptEdits", "user")).toMatch(
      /edit files without asking/,
    );
    expect(riskWarning("permissions.defaultMode", "auto", "user")).toMatch(/without asking/);
    expect(riskWarning("permissions.defaultMode", "dontAsk", "user")).toBeNull();
  });
});
