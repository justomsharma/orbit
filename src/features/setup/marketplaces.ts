import { join } from "node:path";
import { obj, str } from "../../core/jsonl";
import { readJsonFile } from "./jsonFile";

/** A place plugins are installed from (`/plugin marketplace add …`). */
export interface Marketplace {
  name: string;
  /** Where it comes from, for people: a repo, URL or folder. */
  source: string;
  /** Anthropic's own marketplace. */
  official: boolean;
  /** When Claude last refreshed it (ms), if known. */
  lastUpdated: number | null;
}

const OFFICIAL = new Set(["claude-plugins-official", "anthropic-agent-skills"]);

function describeSource(v: unknown): string {
  const s = obj(v);
  if (!s) return "";
  const repo = str(s.repo);
  if (repo) return `github.com/${repo}`;
  return str(s.url) ?? str(s.path) ?? str(s.source) ?? "";
}

/** Claude Code's `plugins/known_marketplaces.json`, by name. Read-only; never throws. */
export async function readMarketplaces(home: string): Promise<Marketplace[]> {
  const f = await readJsonFile(join(home, "plugins", "known_marketplaces.json"));
  if (!f.data) return [];
  const out: Marketplace[] = [];
  for (const [name, raw] of Object.entries(f.data)) {
    const m = obj(raw);
    if (!m || name.length > 200) continue;
    const source = describeSource(m.source);
    const repo = str(obj(m.source)?.repo) ?? "";
    const t = Date.parse(str(m.lastUpdated) ?? "");
    out.push({
      name,
      source,
      official: OFFICIAL.has(name) || repo.toLowerCase().startsWith("anthropics/"),
      lastUpdated: Number.isNaN(t) ? null : t,
    });
  }
  return out.sort(
    (a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name),
  );
}
