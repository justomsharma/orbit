import { useEffect } from "preact/hooks";
import { post } from "./bus";
import { ChatsView } from "./chats/ChatsView";
import { SetupView } from "./setup/SetupView";
import type { Tab } from "./store";
import * as store from "./store";
import { Empty } from "./ui/Empty";
import { Icon } from "./ui/Icon";
import { HomeView } from "./usage/HomeView";
import { UsageView } from "./usage/UsageView";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "chats", label: "Chats", icon: "comment-discussion" },
  { id: "usage", label: "Usage", icon: "graph" },
  { id: "setup", label: "Setup", icon: "settings-gear" },
];

function TabBar() {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex((t) => t.id === store.tab.value);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    store.tab.value = next.id;
    document.getElementById(`tab-${next.id}`)?.focus();
  };
  return (
    <div class="tabs" role="tablist" aria-label="Orbit" onKeyDown={onKey}>
      {TABS.map((t) => {
        const on = store.tab.value === t.id;
        return (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            class={`tab${on ? " on" : ""}`}
            title={t.label}
            onClick={() => (store.tab.value = t.id)}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function App() {
  const t = store.tab.value;
  // Tell the host which tab is open, so it only reads what this tab shows.
  const reading = t === "chats" && store.chatsMode.value === "prompts" ? "prompts" : t;
  useEffect(() => post({ type: "tab", tab: reading }), [reading]);
  return (
    <div class="app">
      <TabBar />
      <main class="panel" role="tabpanel" aria-labelledby={`tab-${t}`}>
        {t === "home" ? (
          <HomeView />
        ) : t === "chats" ? (
          <ChatsView />
        ) : t === "usage" ? (
          <UsageView />
        ) : t === "setup" ? (
          <SetupView />
        ) : (
          <Empty icon="tools" title="Coming soon">
            This tab is being built.
          </Empty>
        )}
      </main>
    </div>
  );
}
