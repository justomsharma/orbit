import type { ViewMsg } from "../../shared/protocol";
import { post } from "../bus";
import type { MenuItem } from "../ui/Menu";
import type { ChatVM } from "./model";
import { openDetails } from "./open";

/** Everything you can do with a chat, for its ⋯ button and right-click. */
export function rowMenu(vm: ChatVM, rename: () => void): MenuItem[] {
  const id = vm.s.id;
  const send = (m: ViewMsg) => () => post(m);
  const items: MenuItem[] = [];
  if (vm.temp)
    items.push({
      label: "Make permanent",
      icon: "save",
      run: send({ type: "chat:mark", ids: [id], set: "temp", on: false }),
    });
  items.push(
    { label: "Rename…", icon: "edit", run: rename },
    {
      label: vm.pinned ? "Unpin" : "Pin to top",
      icon: vm.pinned ? "pinned" : "pin",
      run: send({ type: "pin", id, on: !vm.pinned }),
    },
    { label: "Continue in a terminal", icon: "terminal", run: send({ type: "openTerminal", id }) },
    { label: "Fork into a new chat", icon: "repo-forked", run: send({ type: "forkChat", id }) },
    { label: "Copy resume command", icon: "copy", run: send({ type: "copyResume", id }) },
    { label: "Copy chat id", icon: "key", run: send({ type: "chat:copyId", id }) },
    { kind: "separator" },
    { label: "Files and transcript", icon: "history", run: () => openDetails(id) },
    { label: "Export as Markdown…", icon: "markdown", run: send({ type: "chat:export", id }) },
    { label: "Export chat (.jsonl)…", icon: "export", run: send({ type: "chat:save", ids: [id] }) },
    {
      label: vm.archived ? "Unarchive" : "Archive",
      icon: "archive",
      run: send({ type: "chat:mark", ids: [id], set: "archived", on: !vm.archived }),
    },
    { kind: "separator" },
    vm.hidden
      ? {
          label: "Show in the list again",
          icon: "eye",
          run: send({ type: "chat:mark", ids: [id], set: "hidden", on: false }),
        }
      : {
          label: "Hide from the list",
          icon: "eye-closed",
          danger: true,
          run: send({ type: "chat:mark", ids: [id], set: "hidden", on: true }),
        },
  );
  return items;
}
