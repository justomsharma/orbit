/** Every tab in Orbit's top bar, in order, with what the host reads for it. */
export type Tab =
  | "home"
  | "chats"
  | "prompts"
  | "checkpoints"
  | "usage"
  | "account"
  | "config"
  | "skills"
  | "mcp"
  | "plugins"
  | "agents"
  | "commands"
  | "hooks"
  | "memory";

/** The data a tab needs, so the host only reads that. */
export const READINGS = [
  "home",
  "chats",
  "prompts",
  "checkpoints",
  "usage",
  "account",
  "setup",
] as const;
export type Reading = (typeof READINGS)[number];

export interface TabDef {
  id: Tab;
  label: string;
  icon: string;
  /** One line for the welcome screen: what you can do there. */
  blurb: string;
  reads: Reading;
}

export const TABS: readonly TabDef[] = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    blurb: "Ask Claude, pick up where you left off",
    reads: "home",
  },
  {
    id: "chats",
    label: "Chats",
    icon: "comment-discussion",
    blurb: "Every chat, live status, search inside",
    reads: "chats",
  },
  {
    id: "prompts",
    label: "Prompts",
    icon: "quote",
    blurb: "Everything you've asked, ready to reuse",
    reads: "prompts",
  },
  {
    id: "checkpoints",
    label: "Checkpoints",
    icon: "history",
    blurb: "Compare or restore files Claude changed",
    reads: "checkpoints",
  },
  {
    id: "usage",
    label: "Usage",
    icon: "graph",
    blurb: "Tokens, cost, streaks and your week",
    reads: "usage",
  },
  {
    id: "account",
    label: "Account",
    icon: "account",
    blurb: "Profile, switch accounts, plan limits",
    reads: "account",
  },
  {
    id: "config",
    label: "Config",
    icon: "settings-gear",
    blurb: "Model, effort, permissions, health check",
    reads: "setup",
  },
  {
    id: "skills",
    label: "Skills",
    icon: "sparkle",
    blurb: "Your skills and plugin skills, by scope",
    reads: "setup",
  },
  {
    id: "mcp",
    label: "MCP",
    icon: "plug",
    blurb: "Add, sign in to and turn off servers",
    reads: "setup",
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: "package",
    blurb: "Turn plugins on or off, no JSON",
    reads: "setup",
  },
  {
    id: "agents",
    label: "Agents",
    icon: "hubot",
    blurb: "Helpers Claude hands focused work to",
    reads: "setup",
  },
  {
    id: "commands",
    label: "Commands",
    icon: "terminal",
    blurb: "Your slash commands in one place",
    reads: "setup",
  },
  {
    id: "hooks",
    label: "Hooks",
    icon: "zap",
    blurb: "Scripts that run on Claude's events",
    reads: "setup",
  },
  {
    id: "memory",
    label: "Memory",
    icon: "book",
    blurb: "CLAUDE.md and what Claude remembers",
    reads: "setup",
  },
];

export const TAB_IDS = TABS.map((t) => t.id);

export const isTab = (v: unknown): v is Tab => TAB_IDS.includes(v as Tab);

export const tabDef = (id: Tab): TabDef => TABS.find((t) => t.id === id)!;
