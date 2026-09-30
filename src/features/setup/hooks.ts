import { num, obj, str } from "../../core/jsonl";
import { readPluginHooksFile } from "./pluginFiles";
import type { InstalledPlugin } from "./plugins";
import type { SettingsFile, SettingsScope } from "./settings";

export interface HookEntry {
  /** Stable: `${scope}:${source}:${event}:${group}:${index}`. */
  id: string;
  scope: SettingsScope | "plugin";
  source: string;
  plugin: string | null;
  event: string;
  matcher: string | null;
  /** Position of the matcher group in `hooks[event]`, as written in the file. */
  group: number;
  /** Position of the handler in the group's `hooks`, as written in the file. */
  index: number;
  type: string;
  command: string | null;
  url: string | null;
  timeout: number | null;
}

export interface PluginHooks {
  plugin: string;
  source: string;
  data: unknown;
}

type Origin = Pick<HookEntry, "scope" | "source" | "plugin">;

/** Handlers of one `hooks` object. Malformed groups and handlers are skipped. */
function collect(hooks: unknown, o: Origin, out: HookEntry[]): void {
  const events = obj(hooks);
  if (!events) return;
  for (const [event, groups] of Object.entries(events)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((g, group) => {
      const grp = obj(g);
      if (!grp || !Array.isArray(grp.hooks)) return;
      const matcher = str(grp.matcher);
      grp.hooks.forEach((h, index) => {
        const hook = obj(h);
        const type = str(hook?.type);
        if (!hook || type === null) return;
        out.push({
          id: `${o.scope}:${o.source}:${event}:${group}:${index}`,
          ...o,
          event,
          matcher,
          group,
          index,
          type,
          command: str(hook.command),
          url: str(hook.url),
          timeout: num(hook.timeout),
        });
      });
    });
  }
}

/** Hooks from settings files, then plugins. Pure; header and env values are never copied. */
export function readHooks(settings: SettingsFile[], pluginHooks: PluginHooks[]): HookEntry[] {
  const out: HookEntry[] = [];
  for (const s of settings)
    collect(s.data?.hooks, { scope: s.scope, source: s.path, plugin: null }, out);
  for (const p of pluginHooks) {
    const data = obj(p.data);
    // hooks.json is `{ hooks: {...} }`, or the hooks object itself.
    const hooks = data && obj(data.hooks) ? data.hooks : data;
    collect(hooks, { scope: "plugin", source: p.source, plugin: p.plugin }, out);
  }
  return out;
}

/** `<installPath>/hooks/hooks.json` of each enabled plugin that has one and parses. */
export async function readPluginHooks(plugins: InstalledPlugin[]): Promise<PluginHooks[]> {
  const live = plugins.filter((p) => p.enabled && p.installPath);
  const files = await Promise.all(live.map((p) => readPluginHooksFile(p.installPath)));
  return live.flatMap((p, i) => {
    const f = files[i];
    return f?.data ? [{ plugin: p.id, source: f.path, data: f.data }] : [];
  });
}
