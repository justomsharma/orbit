import { describe, expect, it } from "vitest";
import { makeNonce, renderHtml } from "../html";

const page = () =>
  renderHtml({
    cspSource: "https://file+.vscode-resource.vscode-cdn.net",
    nonce: "abc123",
    scriptUri: "https://x/main.js",
    styleUri: "https://x/main.css",
    codiconUri: "https://x/codicon.css",
  });

function csp(html: string): string {
  return /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
}

describe("renderHtml", () => {
  it("blocks everything by default and forbids network connections", () => {
    const c = csp(page());
    expect(c).toContain("default-src 'none'");
    expect(c).toContain("connect-src 'none'");
    expect(c).not.toContain("https:;");
    expect(c).not.toMatch(/img-src[^;]*https:(?!\/\/file)/);
  });

  it("only runs our own script, by nonce", () => {
    const html = page();
    expect(csp(html)).toContain("script-src 'nonce-abc123'");
    expect(html).toContain('<script nonce="abc123" src="https://x/main.js"></script>');
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it("loads styles and the icon font only from the extension", () => {
    const c = csp(page());
    expect(c).toContain("style-src https://file+.vscode-resource.vscode-cdn.net");
    expect(c).toContain("font-src https://file+.vscode-resource.vscode-cdn.net");
  });
});

describe("makeNonce", () => {
  it("is random, long, and safe inside an attribute", () => {
    const a = makeNonce();
    const b = makeNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
  });
});
