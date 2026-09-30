import { obj, str } from "../../core/jsonl";
import type { SettingsFile, SettingsScope } from "./settings";

export interface PermissionRule {
  scope: SettingsScope;
  list: "allow" | "ask" | "deny";
  rule: string;
}

export interface Permissions {
  rules: PermissionRule[];
  defaultMode: { scope: SettingsScope; mode: string }[];
  additionalDirectories: { scope: SettingsScope; dir: string }[];
}

const LISTS = ["allow", "ask", "deny"] as const;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** `permissions` from every settings file, in file order. Arrays merge across scopes. */
export function readPermissions(settings: SettingsFile[]): Permissions {
  const out: Permissions = { rules: [], defaultMode: [], additionalDirectories: [] };
  for (const { scope, data } of settings) {
    const p = obj(data?.permissions);
    if (!p) continue;
    for (const list of LISTS)
      for (const rule of strings(p[list])) out.rules.push({ scope, list, rule });
    const mode = str(p.defaultMode);
    if (mode !== null) out.defaultMode.push({ scope, mode });
    for (const dir of strings(p.additionalDirectories))
      out.additionalDirectories.push({ scope, dir });
  }
  return out;
}
