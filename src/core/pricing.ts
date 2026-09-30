import type { UsageRecord } from "../features/usage/types";

/**
 * Official API prices from https://platform.claude.com/docs/en/about-claude/pricing,
 * fetched on this date. Unknown models are never guessed.
 */
export const PRICING_AS_OF = "2026-09-30";

/** Dollars per million tokens. */
export interface Price {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

const p = (
  input: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number,
  output: number,
): Price => ({
  input,
  cacheWrite5m,
  cacheWrite1h,
  cacheRead,
  output,
});

const FABLE_51 = p(10, 12.5, 20, 0.25, 50);
const FABLE_5 = p(10, 12.5, 20, 1, 50);
const OPUS_55 = p(4, 5, 8, 0.2, 20);
const OPUS_45 = p(5, 6.25, 10, 0.5, 25);
const OPUS_4 = p(15, 18.75, 30, 1.5, 75);
const SONNET_5 = p(2, 2.5, 4, 0.2, 10);
const SONNET_4 = p(3, 3.75, 6, 0.3, 15);

/** Keyed by `family major.minor`. */
const TABLE: Record<string, Price> = {
  "fable 5.1": FABLE_51,
  "mythos 5.1": FABLE_51,
  "fable 5.0": FABLE_5,
  "mythos 5.0": FABLE_5,
  "opus 5.5": OPUS_55,
  "opus 5.0": OPUS_45,
  "opus 4.8": OPUS_45,
  "opus 4.7": OPUS_45,
  "opus 4.6": OPUS_45,
  "opus 4.5": OPUS_45,
  "opus 4.1": OPUS_4,
  "opus 4.0": OPUS_4,
  "sonnet 5.5": SONNET_5,
  "sonnet 5.0": SONNET_5,
  "sonnet 4.6": SONNET_4,
  "sonnet 4.5": SONNET_4,
  "sonnet 4.0": SONNET_4,
  "sonnet 3.7": SONNET_4,
  "haiku 4.5": p(1, 1.25, 2, 0.1, 5),
  "haiku 3.5": p(0.8, 1, 1.6, 0.08, 4),
  "haiku 3.0": p(0.25, 0.3, 0.5, 0.03, 1.25),
};

/** Fast mode: input/output price; cache prices derive from input with `read` as the read multiplier. */
const FAST: Record<string, { input: number; output: number; read: number }> = {
  "opus 5.5": { input: 8, output: 40, read: 0.05 },
  "opus 5.0": { input: 10, output: 50, read: 0.1 },
  "opus 4.8": { input: 10, output: 50, read: 0.1 },
};

const US_GEO = 1.1;
const WEB_SEARCH = 10 / 1000;

interface ModelId {
  family: string;
  major: number;
  minor: number;
}

/**
 * Reads `claude-opus-5-5`, `claude-3-5-haiku-20241022`, `us.anthropic.claude-…-v1:0`,
 * `claude-haiku-4-5@20251001`, `claude-opus-5-5[1m]` and friends.
 */
function parseModel(model: string): ModelId | null {
  const m = model
    .toLowerCase()
    .trim()
    .match(/^(?:[a-z0-9_-]+\.)*claude-(.+)$/);
  if (!m) return null;
  const core = m[1]!
    .replace(/\[[^\]]*\]$/, "")
    .replace(/@.*$/, "")
    .replace(/-v\d+(?::\d+)?$/, "")
    .replace(/:\d+$/, "")
    .replace(/-(?:\d{8}|latest)$/, "");
  const modern = core.match(/^(opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (modern) return { family: modern[1]!, major: +modern[2]!, minor: +(modern[3] ?? 0) };
  const legacy = core.match(/^(\d)(?:-(\d))?-(opus|sonnet|haiku)$/);
  if (legacy) return { family: legacy[3]!, major: +legacy[1]!, minor: +(legacy[2] ?? 0) };
  return null;
}

const keyOf = (id: ModelId) => `${id.family} ${id.major}.${id.minor}`;

export function priceFor(model: string): Price | null {
  const id = parseModel(model);
  return id ? (TABLE[keyOf(id)] ?? null) : null;
}

/** "Opus 5.5" for `claude-opus-5-5-…`; the raw id when it can't be read. */
export function modelLabel(model: string): string {
  const id = parseModel(model);
  if (!id) return model;
  const name = id.family[0]!.toUpperCase() + id.family.slice(1);
  return id.minor ? `${name} ${id.major}.${id.minor}` : `${name} ${id.major}`;
}

/** Cost in dollars, or null when the model's price is unknown. */
export function costOf(u: UsageRecord): number | null {
  const id = parseModel(u.model);
  const key = id && keyOf(id);
  let price = key ? TABLE[key] : undefined;
  if (!id || !key || !price) return null;
  const fast = u.fast ? FAST[key] : undefined;
  if (fast) {
    price = p(fast.input, fast.input * 1.25, fast.input * 2, fast.input * fast.read, fast.output);
  }
  let tokens =
    (u.input * price.input +
      u.cacheWrite5m * price.cacheWrite5m +
      u.cacheWrite1h * price.cacheWrite1h +
      u.cacheRead * price.cacheRead +
      u.output * price.output) /
    1_000_000;
  // US-only inference costs 1.1× on Claude 4.6 and later.
  if (u.usGeo && (id.major > 4 || (id.major === 4 && id.minor >= 6))) tokens *= US_GEO;
  return tokens + u.webSearches * WEB_SEARCH;
}
