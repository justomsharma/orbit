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
