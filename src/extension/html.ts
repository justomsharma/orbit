import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A cryptographically random nonce so only our own script can run in the webview. */
export function makeNonce(): string {
  const bytes = randomBytes(32);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export interface PageParts {
  cspSource: string;
  nonce: string;
  scriptUri: string;
  styleUri: string;
  codiconUri: string;
}

/**
 * The webview page. The policy blocks everything by default, allows only our
 * bundled script (by nonce), styles and icon font, and forbids any network
 * connection — Orbit is 100% local.
 */
export function renderHtml(p: PageParts): string {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${p.nonce}'`,
    `style-src ${p.cspSource}`,
    `font-src ${p.cspSource}`,
    `img-src ${p.cspSource} data:`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${p.codiconUri}">
<link rel="stylesheet" href="${p.styleUri}">
<title>Orbit</title>
</head>
<body>
<div id="root"></div>
<script nonce="${p.nonce}" src="${p.scriptUri}"></script>
</body>
</html>`;
}
