import * as store from "../store";
import type { Filter } from "./model";

/** The chip in effect: the chosen one, else "All" so no chat ever seems missing. */
export function effectiveFilter(): Filter {
  return store.filter.value ?? "all";
}

/** Does a chat pass the chip in effect? */
export function passesFilter(id: string, f: Filter = effectiveFilter()): boolean {
  if (f === "workspace") return store.here.value.includes(id);
  if (f === "pinned") return store.pins.value.includes(id);
  if (f === "live") return store.live.value.some((l) => l.sessionId === id);
  return true;
}
