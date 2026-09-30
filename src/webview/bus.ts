import type { HostMsg, ViewMsg } from "../shared/protocol";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}

let api: VsCodeApi | null = null;
function vscode(): VsCodeApi | null {
  if (api) return api;
  if (typeof acquireVsCodeApi === "function") api = acquireVsCodeApi();
  return api;
}

/** Sends a message to the extension host. Replaceable in tests. */
export let post = (msg: ViewMsg): void => {
  vscode()?.postMessage(msg);
};

export function setPost(fn: (msg: ViewMsg) => void): void {
  post = fn;
}

export function onHostMessage(fn: (msg: HostMsg) => void): () => void {
  const handler = (e: MessageEvent) => {
    const m = e.data as HostMsg | undefined;
    if (m && typeof m === "object" && typeof m.type === "string") fn(m);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/** Small UI state (tab, filter) that survives the view being hidden and shown again. */
export function loadViewState<T>(fallback: T): T {
  const s = vscode()?.getState();
  return s && typeof s === "object" ? { ...fallback, ...(s as object) } : fallback;
}

export function saveViewState(s: unknown): void {
  vscode()?.setState(s);
}
