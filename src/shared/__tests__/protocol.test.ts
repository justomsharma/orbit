import { describe, expect, it } from "vitest";
import { parseViewMsg } from "../protocol";

const ID = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";

describe("parseViewMsg", () => {
  it.each([
    { type: "ready" },
    { type: "refresh" },
    { type: "openChat", id: ID },
    { type: "openTerminal", id: ID },
    { type: "copyResume", id: ID },
    { type: "pin", id: ID, on: true },
    { type: "rename", id: ID, title: "Checkout rewrite" },
    { type: "rename", id: ID, title: "" },
    { type: "openLink", url: "https://github.com/acme/shop/pull/7" },
    { type: "newChat" },
    { type: "quota", on: true },
    { type: "copyRecap" },
    { type: "tab", tab: "setup" },
    { type: "saveRecapImage", dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
  ])("accepts %j", (m) => {
    expect(parseViewMsg(m)).toEqual(m);
  });

  it.each([
    null,
    "openChat",
    { type: "nope" },
    { type: "openChat" },
    { type: "openChat", id: "x; rm -rf /" },
    { type: "pin", id: ID, on: "yes" },
    { type: "rename", id: ID, title: "x".repeat(201) },
    { type: "openLink", url: "file:///etc/passwd" },
    { type: "openLink", url: "command:workbench.action.terminal.new" },
    { type: "openLink", url: "javascript:alert(1)" },
    { type: "quota", on: "yes" },
    { type: "tab", tab: "settings" },
    { type: "saveRecapImage", dataUrl: "data:text/html;base64,PGgxPg==" },
    { type: "saveRecapImage", dataUrl: "data:image/png;base64,<script>" },
    { type: "saveRecapImage", dataUrl: `data:image/png;base64,${"A".repeat(9 * 1024 * 1024)}` },
  ])("rejects %j", (m) => {
    expect(parseViewMsg(m)).toBeNull();
  });
});
