/** One billed Claude response, taken from a transcript's assistant line. */
export interface UsageRecord {
  /** `message.id` — the same response can appear on many lines and in many files. */
  id: string;
  /** Epoch ms of the line's timestamp. */
  t: number;
  model: string;
  session: string;
  cwd: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  webSearches: number;
  /** `usage.speed === "fast"`. */
  fast: boolean;
  /** `usage.inference_geo === "us"` (US-only inference). */
  usGeo: boolean;
  /** Tools this reply called (`mcp__server__tool` for MCP), when it called any. */
  tools?: string[];
}
