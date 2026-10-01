import type { SettingsFile, SettingsScope } from "./settings";
import schema from "./settingsSchema.json";

export type SettingKind = "boolean" | "string" | "number" | "enum" | "json";

export interface SettingDef {
  key: string;
  kind: SettingKind;
  description: string;
  enum?: string[];
  /** Common values for an open text setting (e.g. theme names; custom values allowed). */
  suggestions?: string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  /** A whole number. */
  integer?: boolean;
  deprecated: boolean;
  group: string;
  /** Only meaningful in organisation-managed settings; not offered for personal editing. */
  managedOnly: boolean;
}

/** Friendly sections, most useful first. Keys not listed go to "More". */
const GROUPS: [string, string[]][] = [
  [
    "Model & thinking",
    [
      "model",
      "effortLevel",
      "alwaysThinkingEnabled",
      "fastMode",
      "fallbackModel",
      "advisorModel",
      "showThinkingSummaries",
      "availableModels",
      "modelOverrides",
    ],
  ],
  [
    "Permissions & safety",
    [
      "permissions",
      "autoMode",
      "sandbox",
      "disableAutoMode",
      "skipDangerousModePermissionPrompt",
      "permissionExplainerEnabled",
    ],
  ],
  [
    "Memory & context",
    [
      "autoMemoryEnabled",
      "autoMemoryDirectory",
      "autoCompactEnabled",
      "claudeMdExcludes",
      "cleanupPeriodDays",
      "fileCheckpointingEnabled",
      "respectGitignore",
    ],
  ],
  [
    "Look & feel",
    [
      "theme",
      "tui",
      "viewMode",
      "outputStyle",
      "language",
      "editorMode",
      "prefersReducedMotion",
      "spinnerTipsEnabled",
      "spinnerVerbs",
      "showTurnDuration",
      "terminalProgressBarEnabled",
      "syntaxHighlightingDisabled",
      "verbose",
      "autoScrollEnabled",
    ],
  ],
  [
    "Git & pull requests",
    ["attribution", "includeCoAuthoredBy", "includeGitInstructions", "prUrlTemplate", "worktree"],
  ],
  [
    "Automation",
    ["hooks", "disableAllHooks", "statusLine", "subagentStatusLine", "env", "defaultShell"],
  ],
  [
    "Plugins, skills & MCP",
    [
      "enabledPlugins",
      "extraKnownMarketplaces",
      "skillOverrides",
      "disableBundledSkills",
      "enableAllProjectMcpServers",
      "enabledMcpjsonServers",
      "disabledMcpjsonServers",
    ],
  ],
  ["Notifications", ["inputNeededNotifEnabled", "agentPushNotifEnabled", "preferredNotifChannel"]],
  ["Updates", ["autoUpdatesChannel", "minimumVersion"]],
];

const MANAGED_ONLY =
  /^(allowManaged|forceLogin|strict|blocked|required(Min|Max)imumVersion|managed|allowed(Mcp|Channel|HttpHook)|denied|httpHookAllowedEnvVars|companyAnnouncements|policyHelper|allowAllClaudeAiMcps|enforceAvailableModels|forceRemoteSettingsRefresh|requireCowork|disableSideloadFlags|parentSettingsBehavior|otelHeadersHelper|pluginTrustMessage)/;

interface RawDef {
  kind: SettingKind;
  description: string;
  enum?: string[];
  suggestions?: string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  integer?: boolean;
  deprecated?: boolean;
}

let cached: SettingDef[] | null = null;

export function settingsCatalog(): SettingDef[] {
  if (cached) return cached;
  const keys = (schema as { keys: Record<string, RawDef> }).keys;
  const groupOf = new Map<string, string>();
  const rank = new Map<string, number>();
  for (const [g, list] of GROUPS) {
    list.forEach((k, i) => {
      groupOf.set(k, g);
      rank.set(k, i);
    });
  }
  const order = [...GROUPS.map(([g]) => g), "More"];
  cached = Object.entries(keys)
    .map(([key, d]) => ({
      key,
      kind: d.kind,
      description: d.description,
      ...(d.enum ? { enum: d.enum } : {}),
      ...(d.suggestions ? { suggestions: d.suggestions } : {}),
      ...(d.minimum !== undefined ? { minimum: d.minimum } : {}),
      ...(d.maximum !== undefined ? { maximum: d.maximum } : {}),
      ...(d.exclusiveMinimum !== undefined ? { exclusiveMinimum: d.exclusiveMinimum } : {}),
      ...(d.exclusiveMaximum !== undefined ? { exclusiveMaximum: d.exclusiveMaximum } : {}),
      ...(d.integer ? { integer: true } : {}),
      deprecated: d.deprecated === true,
      group: groupOf.get(key) ?? "More",
      managedOnly: MANAGED_ONLY.test(key),
    }))
    // Groups in order; inside a group the most useful settings first, then the rest A–Z.
    .sort(
      (a, b) =>
        order.indexOf(a.group) - order.indexOf(b.group) ||
        (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999) ||
        a.key.localeCompare(b.key),
    );
  return cached;
}

export const SCHEMA_SOURCE = (schema as { source: string; fetchedAt: string }).source;
export const SCHEMA_FETCHED_AT = (schema as { fetchedAt: string }).fetchedAt;

/** Highest precedence first: managed > local > project > user. */
export const PRECEDENCE: SettingsScope[] = ["managed", "local", "project", "user"];

/** The value Claude Code will use for `key`, and the file it comes from. */
export function effectiveSetting(
  files: SettingsFile[],
  key: string,
): { value: unknown; scope: SettingsScope } | null {
  for (const scope of PRECEDENCE) {
    const f = files.find((x) => x.scope === scope);
    if (f?.data && Object.hasOwn(f.data, key)) return { value: f.data[key], scope };
  }
  return null;
}

/**
 * Documented in code.claude.com/docs but missing from the published schema
 * (the schema can lag behind Claude Code releases).
 */
const DOCUMENTED_EXTRA = new Set(["modelSettings", "modelPicker"]);

/** Top-level keys not in Claude Code's published list (typos, or newer than Orbit's copy), sorted. */
export function unknownKeys(data: Record<string, unknown>): string[] {
  const known = (schema as { keys: Record<string, unknown> }).keys;
  return Object.keys(data)
    .filter((k) => k !== "$schema" && !Object.hasOwn(known, k) && !DOCUMENTED_EXTRA.has(k))
    .sort();
}

/** Why a value breaks a number setting's limits (Claude's own schema), or null when it fits. */
export function numberProblem(def: SettingDef, v: number): string | null {
  if (!Number.isFinite(v)) return "needs a number";
  if (def.integer && !Number.isInteger(v)) return "needs a whole number";
  if (def.minimum !== undefined && v < def.minimum) return `must be at least ${def.minimum}`;
  if (def.maximum !== undefined && v > def.maximum) return `must be at most ${def.maximum}`;
  if (def.exclusiveMinimum !== undefined && v <= def.exclusiveMinimum)
    return `must be more than ${def.exclusiveMinimum}`;
  if (def.exclusiveMaximum !== undefined && v >= def.exclusiveMaximum)
    return `must be less than ${def.exclusiveMaximum}`;
  return null;
}
