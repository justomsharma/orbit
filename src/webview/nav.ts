import type { Tab } from "../shared/tabs";
import * as store from "./store";

/** Opens a tab from anywhere in the view (links, Get started, the welcome screen, the palette). */
export function openTab(t: Tab): void {
  store.details.value = null;
  store.tab.value = t;
}
