import { describe, expect, it } from "vitest";
import {
  checkTranscript,
  manifest,
  projectFolderName,
  readManifest,
  rewriteTranscript,
} from "../portable";

const A = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const B = "11111111-2222-4333-8444-555555555555";
const line = (o: object) => JSON.stringify(o);
const user = (id: string, text: string) =>
  line({
    type: "user",
    sessionId: id,
    cwd: "/code/shop",
    message: { role: "user", content: text },
  });

describe("checkTranscript", () => {
  it("accepts one chat and counts what's in it", () => {
    const t = [
      user(A, "hi"),
      line({ type: "assistant", sessionId: A, message: { content: [] } }),
      user(A, "again"),
    ].join("\n");
    expect(checkTranscript(t)).toEqual({
      sessionId: A,
      cwd: "/code/shop",
      entries: 3,
      userMessages: 2,
    });
  });

  it.each([
    ["", /empty/],
    ["{oops", /isn't valid JSON/],
    [line({ type: "user", message: { content: "hi" } }), /No chat id/],
    [[user(A, "a"), user(B, "b")].join("\n"), /more than one chat/],
    [line({ type: "assistant", sessionId: A }), /no messages from you/],
  ])("refuses %j", (text, why) => {
    expect(() => checkTranscript(text)).toThrow(why);
  });
});

describe("rewriteTranscript", () => {
  it("gives every line the new id (and folder), without touching text that mentions the old id", () => {
    const t = [user(A, `see ${A}`), line({ type: "summary", summary: "x" })].join("\n");
    const out = rewriteTranscript(t, B, "/new/place")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(out[0].sessionId).toBe(B);
    expect(out[0].cwd).toBe("/new/place");
    expect(out[0].message.content).toBe(`see ${A}`);
    expect(out[1].sessionId).toBeUndefined();
  });
});

describe("manifest", () => {
  it("round-trips, dropping entries without a real id", () => {
    const e = {
      id: A,
      file: `sessions/${A}.jsonl`,
      name: "Fix cart",
      project: "shop",
      projectPath: "/code/shop",
      branch: "main",
      startTime: 1,
      endTime: 2,
      messageCount: 3,
    };
    const text = manifest([e]).replace('"count": 1', '"count": 2').replace("[", `[{"id":"x"},`);
    expect(readManifest(text)).toEqual([e]);
    expect(readManifest("nope")).toEqual([]);
  });
});

describe("projectFolderName", () => {
  it("follows Claude Code's naming", () => {
    expect(projectFolderName("C:\\Learnings\\Make My")).toBe("C--Learnings-Make-My");
    const long = projectFolderName(`/${"a".repeat(300)}`);
    expect(long.length).toBeGreaterThan(200);
    expect(long.startsWith("-aaa")).toBe(true);
  });
});
