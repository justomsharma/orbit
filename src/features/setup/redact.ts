/**
 * Hides credentials in what the Setup tab shows: MCP server args and URLs, and
 * hook commands and URLs. Pure. It errs toward hiding: a false alarm costs one
 * "•••", a miss shows someone's token. Environment references like `${TOKEN}`
 * are kept, since they are how people keep secrets out of config.
 */

export const MASK = "•••";

/** Name words that mark a secret: `--api-key`, `GITHUB_TOKEN`, `client_secret`, `X-Amz-Signature`… */
const SECRET_WORDS = new Set([
  "key",
  "keys",
  "apikey",
  "token",
  "tokens",
  "secret",
  "secrets",
  "password",
  "passwd",
  "pwd",
  "pass",
  "passphrase",
  "auth",
  "authorization",
  "signature",
  "sig",
  "credential",
  "credentials",
  "bearer",
  "pat",
]);

/** Short flags that take a secret (`-k <key>`). */
const SECRET_SHORT = new Set(["k"]);

/** Token formats with a well-known prefix (OpenAI/Anthropic, GitHub, GitLab, Slack, AWS, Google, JWT, npm, Hugging Face, Stripe). */
const KNOWN =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|[spr]k_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abposr]-[A-Za-z0-9-]{8,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,})/g;
const KNOWN_WHOLE = new RegExp(`^(?:${KNOWN.source})$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_REF = /^\$(?:\{[A-Za-z_]\w*(?::?-[^}]*)?\}|[A-Za-z_]\w*)$/;

const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Does a flag, parameter, header or variable name look like it holds a secret? */
export function secretName(name: string): boolean {
  return words(name).some((w) => SECRET_WORDS.has(w));
}

const secretFlag = (flag: string) => {
  const name = flag.replace(/^-+/, "");
  return (!flag.startsWith("--") && SECRET_SHORT.has(name)) || secretName(name);
};

/** A value to hide, unless it only names where the secret comes from. */
const mask = (value: string) => (ENV_REF.test(value) ? value : MASK);

const longestRun = (s: string) =>
  Math.max(0, ...(s.match(/[A-Za-z0-9]+/g) ?? []).map((r) => r.length));
const mixed = (s: string) => /[A-Za-z]/.test(s) && /\d/.test(s);

/** A random-looking string: base64 or hex, 32+ characters, with a long unbroken run. */
function longToken(s: string): boolean {
  return /^[A-Za-z0-9+/_-]{32,}={0,2}$/.test(s) && mixed(s) && longestRun(s) >= 16;
}

/** A URL path segment that looks like a credential (Zapier, Smithery, webhook style). */
function credentialSegment(seg: string): boolean {
  if (!seg) return false;
  if (KNOWN_WHOLE.test(seg) || UUID.test(seg)) return true;
  return seg.length >= 20 && /^[\w.~+=-]+$/.test(seg) && mixed(seg) && longestRun(seg) >= 12;
}

/** `a=1&token=2` with secret-looking values hidden. */
function redactParams(q: string): string {
  return q
    .split("&")
    .map((p) => {
      const i = p.indexOf("=");
      if (i < 0) return p;
      const name = p.slice(0, i);
      const value = p.slice(i + 1);
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        // keep the raw name
      }
      return secretName(decoded) || KNOWN_WHOLE.test(value) || longToken(value)
        ? `${name}=${mask(value)}`
        : p;
    })
    .join("&");
}

const URL_PARTS = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*@)?([^/?#]*)([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/i;

/**
 * The URL with its userinfo, secret-looking query and fragment values, and
 * credential-like path segments replaced by "•••". Anything that isn't a URL is returned as is.
 */
export function redactUrl(url: string): string {
  const m = url.match(URL_PARTS);
  if (!m) return url;
  const [, scheme = "", user, host = "", path = "", query, frag] = m;
  const segs = path
    .split("/")
    .map((s) => (credentialSegment(s) ? MASK : s))
    .join("/");
  const q = query === undefined ? "" : `?${redactParams(query.slice(1))}`;
  const f =
    frag === undefined
      ? ""
      : `#${frag.includes("=") ? redactParams(frag.slice(1)) : frag.slice(1)}`;
  return `${scheme}${user ? `${MASK}@` : ""}${host}${segs}${q}${f}`;
}

const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const FLAG_VALUE = /(^|\s)(--[A-Za-z][\w.-]*)(=|\s+)(["']?)([^\s"'-][^\s"']*)\4/g;
const USER_PASS = /(^|\s)(-u|--user)(=|\s+)(["']?)([^\s"':]+:[^\s"']+)\4/g;
const ASSIGN = /(^|[\s"'&?;])([A-Za-z_][\w.-]*)=(["']?)([^\s"'&;]+)\3/g;
const SCHEME = /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]+)/g;
const HEADER = /(^|[\s"'])([A-Za-z][\w-]*)(:\s*)([^\s"']+)/g;
const LONG_IN_TEXT = /(^|[\s"'=:,(])([A-Za-z0-9+/_-]{32,}={0,2})(?=$|[\s"',)])/g;

/**
 * Free text such as a hook command with tokens hidden, kept readable: the
 * command and its flags stay, only the secret values become "•••".
 */
export function redactText(text: string): string {
  return text
    .replace(URL_IN_TEXT, (u) => redactUrl(u))
    .replace(SCHEME, (all, scheme: string, sp: string, v: string) =>
      v === MASK ? all : `${scheme}${sp}${MASK}`,
    )
    .replace(HEADER, (all, pre: string, name: string, sep: string, v: string) =>
      secretName(name) && !/^(Bearer|Basic)$/i.test(v) && v !== MASK && !ENV_REF.test(v)
        ? `${pre}${name}${sep}${MASK}`
        : all,
    )
    .replace(
      USER_PASS,
      (_, pre: string, flag: string, sep: string, q: string) =>
        `${pre}${flag}${sep}${q}${MASK}${q}`,
    )
    .replace(FLAG_VALUE, (all, pre: string, flag: string, sep: string, q: string, v: string) =>
      secretName(flag) ? `${pre}${flag}${sep}${q}${mask(v)}${q}` : all,
    )
    .replace(ASSIGN, (all, pre: string, name: string, q: string, v: string) =>
      secretName(name) ? `${pre}${name}=${q}${mask(v)}${q}` : all,
    )
    .replace(KNOWN, MASK)
    .replace(LONG_IN_TEXT, (all, pre: string, v: string) => (longToken(v) ? `${pre}${MASK}` : all));
}

const FLAG = /^(-{1,2}[A-Za-z][\w.-]*)(?:=([\s\S]*))?$/;
const ASSIGN_ARG = /^([A-Za-z_][\w.-]*)=([\s\S]*)$/;

/**
 * Program arguments with secrets hidden: the value after a secret flag
 * (`--api-key x`, `-k x`), `--token=x`, `API_KEY=x`, URLs, and bare tokens.
 */
export function redactArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let hideNext = false;
  for (const a of args) {
    const flag = a.match(FLAG);
    if (hideNext && !flag) {
      out.push(mask(a));
      hideNext = false;
      continue;
    }
    hideNext = false;
    if (flag) {
      const [, name = "", value] = flag;
      if (value === undefined) {
        hideNext = secretFlag(name);
        out.push(a);
      } else out.push(`${name}=${secretFlag(name) ? mask(value) : redactText(value)}`);
      continue;
    }
    const assign = a.match(ASSIGN_ARG);
    if (assign && secretName(assign[1] ?? "")) {
      out.push(`${assign[1]}=${mask(assign[2] ?? "")}`);
      continue;
    }
    out.push(KNOWN_WHOLE.test(a) || longToken(a) ? MASK : redactText(a));
  }
  return out;
}
