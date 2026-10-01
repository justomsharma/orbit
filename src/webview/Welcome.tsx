import { useEffect, useRef } from "preact/hooks";
import { TABS, type Tab } from "../shared/tabs";
import { post } from "./bus";
import * as store from "./store";
import { Icon } from "./ui/Icon";

/** Shown once on first run (and from the footer's "?"): every tab, one line each. */
export function Welcome() {
  const start = useRef<HTMLButtonElement>(null);
  const close = (to?: Tab) => {
    store.welcome.value = false;
    if (store.onboarding.value.welcomed === false) post({ type: "onboarding", action: "welcomed" });
    if (to) {
      store.details.value = null;
      store.tab.value = to;
    }
  };
  useEffect(() => {
    start.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div class="welcome-backdrop">
      <div class="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <h2 id="welcome-title" class="welcome-title">
          Welcome to Orbit
        </h2>
        <p class="welcome-sub">All of Claude Code in one sidebar. Here's what's inside.</p>
        <ul class="welcome-grid">
          {TABS.map((t, i) => (
            <li key={t.id} style={{ "--i": i }}>
              <button type="button" class="welcome-item" onClick={() => close(t.id)}>
                <Icon name={t.icon} />
                <span class="welcome-label">{t.label}</span>
                <span class="welcome-blurb">{t.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
        <p class="welcome-note">
          <Icon name="lock" /> Everything stays on your computer. Every change can be undone, and
          risky ones ask first.
        </p>
        <button ref={start} type="button" class="btn welcome-go" onClick={() => close("home")}>
          Get started
        </button>
      </div>
    </div>
  );
}
