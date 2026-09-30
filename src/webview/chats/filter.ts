import * as store from "../store";
import type { Filter } from "./model";

/** The chip in effect: the chosen one, else "This folder" when it has chats, else "All". */
export function effectiveFilter(): Filter {
  const f = store.filter.value;
  if (f) return f;
  return store.here.value.length > 0 ? "workspace" : "all";
}

/** Does a chat pass the chip in effect? */
export function passesFilter(id: string, f: Filter = effectiveFilter()): boolean {
  if (f === "workspace") return store.here.value.includes(id);
  if (f === "pinned") return store.pins.value.includes(id);
  if (f === "live") return store.live.value.some((l) => l.sessionId === id);
  return true;
}
