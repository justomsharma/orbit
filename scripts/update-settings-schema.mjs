// Dev-only (run before a release): refreshes Orbit's copy of Claude Code's official
// settings schema from SchemaStore, trimmed to what the Settings editor needs.
// Orbit itself never goes online; the trimmed file ships inside the extension.
//   node scripts/update-settings-schema.mjs
import { writeFileSync } from "node:fs";

const URL = "https://json.schemastore.org/claude-code-settings.json";
const res = await fetch(URL);
if (!res.ok) throw new Error(`${URL}: ${res.status}`);
const schema = await res.json();

/** Every branch of anyOf/oneOf is a string: an open text setting, with any enum values as suggestions. */
function stringUnion(p) {
  const branches = p.anyOf ?? p.oneOf;
  if (!Array.isArray(branches) || !branches.every((b) => b.type === "string")) return null;
  return branches.flatMap((b) => (Array.isArray(b.enum) ? b.enum : []));
}

function kind(p) {
  if (stringUnion(p)) return "string";
  if (Array.isArray(p.enum) && p.enum.every((v) => typeof v === "string")) return "enum";
  const t = Array.isArray(p.type) ? p.type.filter((x) => x !== "null") : [p.type];
  if (t.length === 1 && ["boolean", "string", "number", "integer"].includes(t[0])) {
    return t[0] === "integer" ? "number" : t[0];
  }
  return "json";
}

const entries = {};
for (const [key, p] of Object.entries(schema.properties ?? {})) {
  if (key === "$schema") continue;
  const description = String(p.description ?? "").trim();
  entries[key] = {
    kind: kind(p),
    description,
    ...(Array.isArray(p.enum) ? { enum: p.enum } : {}),
    ...(stringUnion(p)?.length ? { suggestions: stringUnion(p) } : {}),
    ...(typeof p.minimum === "number" ? { minimum: p.minimum } : {}),
    ...(/^DEPRECATED/i.test(description) ? { deprecated: true } : {}),
  };
}

const out = {
  source: URL,
  fetchedAt: new Date().toISOString().slice(0, 10),
  keys: entries,
};
writeFileSync("src/features/setup/settingsSchema.json", `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${Object.keys(entries).length} settings`);
