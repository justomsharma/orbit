import { post } from "../bus";
import * as store from "../store";

/** Opens a chat's details and asks the host for its changes. */
export function openDetails(id: string): void {
  store.details.value = { id, files: null };
  store.conversation.value = null;
  post({ type: "chat:details", id });
}
