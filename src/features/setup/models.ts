/** A model people can pick in Config, with a plain description. */
export interface ModelOption {
  value: string;
  label: string;
  description: string;
}

/** Claude Code's model aliases: they always mean the newest model of that kind. */
export const MODEL_ALIASES: ModelOption[] = [
  { value: "opus", label: "Opus", description: "Most capable, for the hardest work" },
  { value: "sonnet", label: "Sonnet", description: "Balanced daily driver" },
  { value: "haiku", label: "Haiku", description: "Fastest and cheapest" },
  {
    value: "opusplan",
    label: "Opus plans, Sonnet builds",
    description: "Opus while planning, Sonnet for the work",
  },
  { value: "opus[1m]", label: "Opus · 1M context", description: "Opus with a very long memory" },
  {
    value: "sonnet[1m]",
    label: "Sonnet · 1M context",
    description: "Sonnet with a very long memory",
  },
];

const text = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;

/**
 * The aliases plus the extra models Claude Code offers this account (it caches
 * them in ~/.claude.json as `additionalModelOptionsCache`), without duplicates.
 */
export function modelOptions(claudeJson: unknown): ModelOption[] {
  const out = [...MODEL_ALIASES];
  const cache =
    claudeJson && typeof claudeJson === "object"
      ? (claudeJson as Record<string, unknown>).additionalModelOptionsCache
      : null;
  if (!Array.isArray(cache)) return out;
  for (const raw of cache.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const value = text(r.value, 120);
    if (!value || !/^[\w.:@[\]/-]+$/.test(value) || out.some((m) => m.value === value)) continue;
    out.push({
      value,
      label: text(r.label, 60) ?? value,
      description: text(r.description, 160) ?? "",
    });
  }
  return out;
}
