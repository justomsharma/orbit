import { useEffect, useRef } from "preact/hooks";
import { arrangeTabs, type Tab, tabDef } from "../shared/tabs";
import { AccountView } from "./account/AccountView";
import { post } from "./bus";
import { ChatsView } from "./chats/ChatsView";
import { PromptsView } from "./chats/PromptsView";
import { CheckpointsView } from "./checkpoints/CheckpointsView";
import { openTab } from "./nav";
import { Palette } from "./palette/Palette";
import { ConfigView } from "./setup/ConfigView";
import { SetupPage } from "./setup/SetupPage";
import * as store from "./store";
import { revealInStrip, useEdgeScroll } from "./ui/edgeScroll";
import { Guard } from "./ui/Guard";
import { Icon, IconButton } from "./ui/Icon";
import { MenuLayer } from "./ui/Menu";
import { HomeView } from "./usage/HomeView";
import { UsageView } from "./usage/UsageView";
import { Welcome } from "./Welcome";

export { openTab };

function TabBar() {
  const strip = useRef<HTMLDivElement>(null);
  useEdgeScroll(strip);
  const current = store.tab.value;
  const prefs = store.env.value?.prefs;
  const TABS = arrangeTabs(prefs?.tabOrder, prefs?.hiddenTabs);

  // A hidden tab can't stay open: go to the first one shown.
  useEffect(() => {
    if (!TABS.some((t) => t.id === current)) openTab(TABS[0]!.id);
  }, [current, TABS.map((t) => t.id).join()]);

  // Keep the open tab in sight, also when it was opened from elsewhere.
  useEffect(() => {
    const reveal = () => {
      const el = document.getElementById(`tab-${current}`);
      if (strip.current && el) revealInStrip(strip.current, el);
    };
    reveal();
    // Again once the tab's name has slid open, so it isn't left half outside.
    const t = setTimeout(reveal, 240);
    return () => clearTimeout(t);
  }, [current]);

  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === store.tab.value);
    const n = TABS.length;
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % n
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i + n - 1) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    openTab(TABS[to]!.id);
    document.getElementById(`tab-${TABS[to]!.id}`)?.focus();
  };

  return (
    <div class="tabbar">
      <div class="tabs" role="tablist" aria-label="Orbit" ref={strip} onKeyDown={onKey}>
        {TABS.map((t) => {
          const on = current === t.id;
          return (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="panel"
              tabIndex={on ? 0 : -1}
              class={`tab${on ? " on" : ""}`}
              title={t.label}
              onClick={() => openTab(t.id)}
            >
              <Icon name={t.icon} />
              <span class="tab-label">{t.label}</span>
            </button>
          );
        })}
      </div>
      <IconButton
        icon="search"
        label="Search everything (Ctrl+K)"
        onClick={() => (store.paletteOpen.value = true)}
      />
      <IconButton
        icon="refresh"
        label="Refresh everything (Ctrl+Alt+R)"
        spin={store.reloading.value !== null}
        onClick={() => {
          store.reloading.value = Date.now();
          post({ type: "refresh" });
          // Never spins forever if no answer comes.
          const since = store.reloading.value;
          setTimeout(() => {
            if (store.reloading.value === since) store.reloading.value = null;
          }, 10_000);
        }}
      />
    </div>
  );
}

function Footer() {
  return (
    <footer class="footer">
      <span class="footer-name">Orbit HQ</span>
      <IconButton
        icon="question"
        label="What's in Orbit"
        onClick={() => (store.welcome.value = true)}
      />
      <IconButton
        icon="github"
        label="Orbit on GitHub"
        onClick={() => post({ type: "openOrbitLink", link: "repo" })}
      />
      <IconButton
        icon="comment"
        label="Report a problem or ask for a feature"
        onClick={() => post({ type: "openOrbitLink", link: "issue" })}
      />
    </footer>
  );
}

function Panel({ t }: { t: Tab }) {
  switch (t) {
    case "home":
      return <HomeView />;
    case "chats":
      return <ChatsView />;
    case "prompts":
      return (
        <div class="chats-tab">
          <section class="chats">
            <PromptsView />
          </section>
        </div>
      );
    case "checkpoints":
      return <CheckpointsView />;
    case "usage":
      return <UsageView />;
    case "account":
      return <AccountView />;
    case "config":
      return <ConfigView />;
    default:
      return <SetupPage page={t} />;
  }
}

export function App() {
  const t = store.tab.value;
  // Tell the host which data the open tab shows, so it only reads that.
  const reading = tabDef(t).reads;
  useEffect(() => post({ type: "tab", tab: reading }), [reading]);
  // Each page starts with an empty search.
  useEffect(() => {
    store.setupQuery.value = "";
  }, [t]);
  return (
    <div class={`app${store.env.value?.prefs?.density === "compact" ? " compact" : ""}`}>
      {store.reloading.value !== null ? (
        <div class="busy-bar" role="progressbar" aria-label="Refreshing" />
      ) : null}
      <TabBar />
      <main id="panel" class="panel" role="tabpanel" aria-labelledby={`tab-${t}`}>
        <Guard key={t} name={tabDef(t).label}>
          <Panel t={t} />
        </Guard>
      </main>
      <Footer />
      {store.welcome.value ? <Welcome /> : null}
      <MenuLayer />
      <Palette />
    </div>
  );
}
