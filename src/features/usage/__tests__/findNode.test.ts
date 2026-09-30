import { describe, expect, it } from "vitest";
import { findNode } from "../findNode";

describe("findNode", () => {
  it("returns the first node on PATH, preferring node.exe on Windows", async () => {
    const r = await findNode({
      platform: "win32",
      run: async () => "C:\\tools\\node\r\nC:\\Program Files\\nodejs\\node.exe\r\n",
    });
    expect(r).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(await findNode({ platform: "linux", run: async () => "/usr/bin/node\n" })).toBe(
      "/usr/bin/node",
    );
  });

  it("returns null when node is not installed", async () => {
    const r = await findNode({
      platform: "darwin",
      run: async () => {
        throw new Error("not found");
      },
    });
    expect(r).toBeNull();
  });
});
