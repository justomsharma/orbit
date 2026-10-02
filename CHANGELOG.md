# Changelog

## 0.3.1

- Now also on Open VSX, for Cursor, Windsurf, VSCodium and other editors. No other changes.

## 0.3.0

- **Plan limits you can read at a glance**: 5-hour and weekly use in the status bar (yellow from 75%,
  red from 90%), and a pace verdict on Account: "Enough to last the week" or when you'd run out.
- **Chats, rebuilt**: live dots (green while working, orange while Claude waits for you), folder,
  branch and worktree on every chat, groups by day, a filter panel, select many to pin, export or hide.
  A chat's page shows its stats and the whole conversation (latest or earliest first, searchable).
  Continue, fork, rename, archive, temporary chats, import and export, and a branch check before
  continuing.
- **Checkpoints in three steps**: chats → files → versions, with sizes, versions the chat no longer
  mentions, Open file, and a guard against unsaved editor changes.
- **A page for everything**: every skill, agent, command, hook, MCP server, plugin and memory opens a
  page with what it is and what you can do. Use skills and commands in a chat, edit agents fully,
  duplicate them, pause or edit one hook, check MCP servers, see which settings file turns a plugin on,
  follow links between memories, and memories of other projects.
- **All of Claude Code's built-in commands** (100+) on Commands, with a link to the docs.
- **Delete without fear**: deleting moves things to Orbit's trash; Undo or the new **Undo history** in
  Config puts them back.
- **Config**: commit and PR attribution, built-in git guidance, voice, status line, reset settings
  (undoable), common permission rules, extra folders for Claude, sidebar tab order and hiding,
  **brain backup and import** (secrets left out), health report and Report a problem.
- **Search everything with Ctrl+K**, a crash guard per tab, slow-load notices with Try again, a
  spinning refresh with `Ctrl+Alt+R`, and compact spacing.

## 0.2.0

- **A tab for everything**: Home, Chats, Prompts, Checkpoints, Usage, Account, Config, Skills, MCP,
  Plugins, Agents, Commands, Hooks and Memory. Icons along the top, the open tab named; hover near
  either end to glide through them.
- **Welcome screen**: everything in Orbit, one line each, the first time you open it (and from **?**).
- **Account**: who's signed in and your plan, save accounts and switch with one click (kept in VS
  Code's encrypted storage), log in or out with Claude's own `claude auth`, plan limits.
- **Config**: model, reasoning effort, thinking, permissions, sandbox, auto-compact, checkpoints,
  memory, answer style and more, in plain words, one click each and undoable.
- **Chats open in a terminal** running Claude Code's CLI by default (any folder, Orbit's icon), or in
  Claude's panel: your choice. Home's box starts Claude with your prompt as the first message, and a
  new button continues the folder's last chat.
- **Checkpoints**: every chat where Claude kept copies of files, to compare or restore.
- **Skills** by scope (project, yours, each plugin), with a link to find more skills and MCP servers.
- **Usage**: streak, active days, favourite model, and the tools and MCP servers Claude used.
- New commands: Orbit: Switch Claude account, Show account, Show checkpoints.

## 0.1.2

- **Ask Claude from Home**: type what Claude should do; Claude's chat opens with it typed in.
- **Fixed**: a chat's hover buttons no longer cover its title.
- The Get started tour now opens by itself once (VS Code skipped it on some installs), and
  Home's checklist has a **Take the tour** link. New command: Orbit: Get started.
- The checklist explains only the next step, so Home stays short.
- Chats tells newcomers that clicking a chat opens it in Claude.

## 0.1.1

- **Get started**: a short walkthrough opens after install, and Home shows a checklist that ticks
  itself as you try things, each with a "Show me" link.
- **Fixed**: the sidebar could slide up, hiding the tabs and leaving an empty bottom half
  (for example after "See your week").
- Chats now opens on **All** chats, so none seem missing; "This folder" is one click away.
- Home shows the first three running chats, with a link to the rest.
- Links look like links; the three figures on Home and Usage always sit side by side.
- New commands: Orbit: Show chats, Show prompts, Show usage, Show setup.

## 0.1.0

First release.

- **Home**: continue your last chat, running chats, today's usage, plan limits and setup warnings.
- **Chats**: every Claude Code chat; search titles or inside messages; filter by folder, branch and
  date; pin, rename and tag; continue in Claude's chat or a terminal; fork into a new chat.
- **Chat details**: files Claude changed with every version, compare with now, safe restore,
  readable transcript, export to Markdown.
- **Prompts**: every prompt you've typed, repeats collapsed, pasted text restored; use again or copy.
- **Usage**: tokens and API-value cost by day, week, month, model and project; activity map; weekly
  recap (image or Markdown); opt-in 5-hour and 7-day plan limits.
- **Setup**: MCP servers, plugins, skills, agents, commands, hooks, permissions, memory, CLAUDE.md and
  settings, with safe edits (preview, backup, undo) and a health check with Fix with Claude.
