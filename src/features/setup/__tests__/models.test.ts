import { describe, expect, it } from "vitest";
import { MODEL_ALIASES, modelOptions } from "../models";

describe("modelOptions", () => {
  it("offers Claude's aliases, plus extra models the account has, once each", () => {
    const opts = modelOptions({
      additionalModelOptionsCache: [
        { value: "claude-fable-5-1[1m]", label: "Fable", description: "Most capable" },
        { value: "opus", label: "Opus again" },
        { value: "bad value; rm -rf", label: "x" },
        "junk",
      ],
    });
    expect(opts.slice(0, MODEL_ALIASES.length)).toEqual(MODEL_ALIASES);
    expect(opts.slice(MODEL_ALIASES.length)).toEqual([
      { value: "claude-fable-5-1[1m]", label: "Fable", description: "Most capable" },
    ]);
  });

  it("works without ~/.claude.json", () => {
    expect(modelOptions(null)).toEqual(MODEL_ALIASES);
  });
});
