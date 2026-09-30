import { describe, expect, it } from "vitest";
import type { UsageRecord } from "../../features/usage/types";
import { costOf, modelLabel, PRICING_AS_OF, priceFor } from "../pricing";

const P = (input: number, w5: number, w1: number, read: number, output: number) => ({
  input,
  cacheWrite5m: w5,
  cacheWrite1h: w1,
  cacheRead: read,
  output,
});

const FABLE_51 = P(10, 12.5, 20, 0.25, 50);
const FABLE_5 = P(10, 12.5, 20, 1, 50);
const OPUS_55 = P(4, 5, 8, 0.2, 20);
const OPUS_45_TO_5 = P(5, 6.25, 10, 0.5, 25);
const OPUS_4 = P(15, 18.75, 30, 1.5, 75);
const SONNET_5 = P(2, 2.5, 4, 0.2, 10);
const SONNET_4 = P(3, 3.75, 6, 0.3, 15);
const HAIKU_45 = P(1, 1.25, 2, 0.1, 5);
const HAIKU_35 = P(0.8, 1, 1.6, 0.08, 4);
const HAIKU_3 = P(0.25, 0.3, 0.5, 0.03, 1.25);

describe("priceFor", () => {
  it("records when the table was fetched", () => {
    expect(PRICING_AS_OF).toBe("2026-09-30");
  });

  it.each([
    ["claude-fable-5-1", FABLE_51],
    ["claude-mythos-5-1", FABLE_51],
    ["claude-fable-5", FABLE_5],
    ["claude-mythos-5", FABLE_5],
    ["claude-opus-5-5", OPUS_55],
    ["claude-opus-5", OPUS_45_TO_5],
    ["claude-opus-4-8", OPUS_45_TO_5],
    ["claude-opus-4-7", OPUS_45_TO_5],
    ["claude-opus-4-6", OPUS_45_TO_5],
    ["claude-opus-4-5-20251101", OPUS_45_TO_5],
    ["claude-opus-4-1-20250805", OPUS_4],
    ["claude-opus-4-20250514", OPUS_4],
    ["claude-opus-4-0", OPUS_4],
    ["claude-sonnet-5-5", SONNET_5],
    ["claude-sonnet-5", SONNET_5],
    ["claude-sonnet-4-6", SONNET_4],
    ["claude-sonnet-4-5-20250929", SONNET_4],
    ["claude-sonnet-4-20250514", SONNET_4],
    ["claude-3-7-sonnet-20250219", SONNET_4],
    ["claude-haiku-4-5", HAIKU_45],
    ["claude-haiku-4-5-20251001", HAIKU_45],
    ["claude-3-5-haiku-20241022", HAIKU_35],
    ["claude-3-haiku-20240307", HAIKU_3],
  ])("%s", (model, price) => {
    expect(priceFor(model)).toEqual(price);
  });

  it.each([
    ["us.anthropic.claude-opus-5-5", OPUS_55],
    ["anthropic.claude-3-5-haiku-20241022-v1:0", HAIKU_35],
    ["global.anthropic.claude-sonnet-4-5-20250929-v1:0", SONNET_4],
    ["claude-haiku-4-5@20251001", HAIKU_45],
    ["claude-opus-5-5[1m]", OPUS_55],
    ["claude-sonnet-4-5[1m]", SONNET_4],
    ["CLAUDE-OPUS-5-5", OPUS_55],
  ])("handles prefixes and suffixes: %s", (model, price) => {
    expect(priceFor(model)).toEqual(price);
  });

  it("never confuses a version with its point release", () => {
    expect(priceFor("claude-opus-5")).toEqual(OPUS_45_TO_5);
    expect(priceFor("claude-opus-5-5")).toEqual(OPUS_55);
    expect(priceFor("claude-sonnet-5")).toEqual(SONNET_5);
    expect(priceFor("claude-sonnet-5-5")).toEqual(SONNET_5);
    expect(priceFor("claude-fable-5")).toEqual(FABLE_5);
    expect(priceFor("claude-fable-5-1")).toEqual(FABLE_51);
    expect(priceFor("claude-opus-4")).toEqual(OPUS_4);
    expect(priceFor("claude-opus-4-5")).toEqual(OPUS_45_TO_5);
  });

  it.each([
    "",
    "<synthetic>",
    "gpt-5",
    "claude-opus-5-9",
    "claude-opus-6",
    "claude-3-opus-20240229",
    "claude-3-5-sonnet-20241022",
    "claude-haiku-5",
    "claude-opus-5-55",
    "claude-opus",
    "my-claude-opus-5-5-fork",
  ])("unknown model %j → null", (model) => {
    expect(priceFor(model)).toBeNull();
  });
});

describe("modelLabel", () => {
  it("names models the way people say them", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(modelLabel("claude-3-5-haiku-20241022")).toBe("Haiku 3.5");
    expect(modelLabel("claude-opus-4-20250514")).toBe("Opus 4");
    expect(modelLabel("us.anthropic.claude-fable-5-1[1m]")).toBe("Fable 5.1");
    expect(modelLabel("gpt-5")).toBe("gpt-5");
  });
});

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: "msg_1",
  t: 0,
  model: "claude-opus-5-5",
  session: "s",
  cwd: "/w",
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  webSearches: 0,
  fast: false,
  usGeo: false,
  ...over,
});

const M = 1_000_000;

describe("costOf", () => {
  it("prices plain input and output", () => {
    expect(costOf(rec({ input: M, output: M }))).toBeCloseTo(4 + 20);
    expect(costOf(rec({ model: "claude-sonnet-4-5", input: 2 * M, output: M / 2 }))).toBeCloseTo(
      6 + 7.5,
    );
  });

  it("prices cache writes (5 minute and 1 hour) and cache reads", () => {
    expect(costOf(rec({ cacheWrite5m: M }))).toBeCloseTo(5);
    expect(costOf(rec({ cacheWrite1h: M }))).toBeCloseTo(8);
    expect(costOf(rec({ cacheRead: M }))).toBeCloseTo(0.2);
    expect(
      costOf(rec({ model: "claude-haiku-4-5", cacheWrite5m: M, cacheWrite1h: M, cacheRead: M })),
    ).toBeCloseTo(1.25 + 2 + 0.1);
  });

  it("prices a realistic small message", () => {
    // 10 in, 50 out, 1000 cache read, 100 1h cache write on Opus 5.5
    const c = costOf(rec({ input: 10, output: 50, cacheRead: 1000, cacheWrite1h: 100 }));
    expect(c).toBeCloseTo((10 * 4 + 50 * 20 + 1000 * 0.2 + 100 * 8) / M, 10);
  });

  it("uses fast mode prices for Opus 5.5 (read at 0.05×)", () => {
    const f = { fast: true };
    expect(costOf(rec({ ...f, input: M, output: M }))).toBeCloseTo(8 + 40);
    expect(costOf(rec({ ...f, cacheWrite5m: M }))).toBeCloseTo(10);
    expect(costOf(rec({ ...f, cacheWrite1h: M }))).toBeCloseTo(16);
    expect(costOf(rec({ ...f, cacheRead: M }))).toBeCloseTo(0.4);
  });

  it("uses fast mode prices for Opus 5 and 4.8 (read at 0.1×)", () => {
    for (const model of ["claude-opus-5", "claude-opus-4-8"]) {
      const f = { model, fast: true };
      expect(costOf(rec({ ...f, input: M, output: M }))).toBeCloseTo(10 + 50);
      expect(costOf(rec({ ...f, cacheWrite5m: M }))).toBeCloseTo(12.5);
      expect(costOf(rec({ ...f, cacheWrite1h: M }))).toBeCloseTo(20);
      expect(costOf(rec({ ...f, cacheRead: M }))).toBeCloseTo(1);
    }
  });

  it("keeps standard prices when a model has no fast mode", () => {
    expect(costOf(rec({ model: "claude-sonnet-5", fast: true, input: M }))).toBeCloseTo(2);
  });

  it("adds 10% for US-only inference on Claude 4.6 and later", () => {
    const u = { usGeo: true, input: M, output: M };
    expect(costOf(rec({ ...u }))).toBeCloseTo(24 * 1.1);
    expect(costOf(rec({ ...u, model: "claude-opus-4-6" }))).toBeCloseTo(30 * 1.1);
    expect(costOf(rec({ ...u, model: "claude-sonnet-4-6" }))).toBeCloseTo(18 * 1.1);
    expect(costOf(rec({ ...u, model: "claude-sonnet-5" }))).toBeCloseTo(12 * 1.1);
    expect(costOf(rec({ ...u, model: "claude-fable-5-1" }))).toBeCloseTo(60 * 1.1);
    expect(costOf(rec({ ...u, model: "claude-opus-5-5", fast: true }))).toBeCloseTo(48 * 1.1);
  });

  it("does not add the US surcharge to models before 4.6", () => {
    const u = { usGeo: true, input: M, output: M };
    expect(costOf(rec({ ...u, model: "claude-opus-4-5" }))).toBeCloseTo(30);
    expect(costOf(rec({ ...u, model: "claude-sonnet-4-5" }))).toBeCloseTo(18);
    expect(costOf(rec({ ...u, model: "claude-haiku-4-5" }))).toBeCloseTo(6);
    expect(costOf(rec({ ...u, model: "claude-opus-4-1" }))).toBeCloseTo(90);
  });

  it("charges $10 per 1000 web searches", () => {
    expect(costOf(rec({ webSearches: 3 }))).toBeCloseTo(0.03);
    expect(costOf(rec({ webSearches: 1000, input: M }))).toBeCloseTo(10 + 4);
    // The surcharge is on tokens only; searches keep their flat price.
    expect(costOf(rec({ webSearches: 1000, usGeo: true }))).toBeCloseTo(10);
  });

  it("returns null for an unknown model, even with web searches", () => {
    expect(costOf(rec({ model: "gpt-5", input: M, webSearches: 5 }))).toBeNull();
  });
});
