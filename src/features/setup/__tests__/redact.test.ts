import { describe, expect, it } from "vitest";
import { MASK, redactArgs, redactText, redactUrl } from "../redact";

const M = MASK;

describe("redactUrl", () => {
  it.each([
    // Userinfo: the whole of it, since a user name can be a token too.
    ["postgres://ana:hunter2@db.local:5432/shop", `postgres://${M}@db.local:5432/shop`],
    ["https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/x", `https://${M}@github.com/x`],
    // Secret-looking query parameters, any case, and nothing else.
    [
      "https://mcp.example.com/sse?api_key=abc123&team=core",
      `https://mcp.example.com/sse?api_key=${M}&team=core`,
    ],
    ["https://x.dev/mcp?token=t0k&key=k3y", `https://x.dev/mcp?token=${M}&key=${M}`],
    [
      "https://x.dev/a?apiKey=1&access-token=2&client_secret=3&sig=4&Signature=5&password=6&auth=7",
      `https://x.dev/a?apiKey=${M}&access-token=${M}&client_secret=${M}&sig=${M}&Signature=${M}&password=${M}&auth=${M}`,
    ],
    ["https://s3.aws/b/o?X-Amz-Signature=deadbeef", `https://s3.aws/b/o?X-Amz-Signature=${M}`],
    // Credentials in the path: long random segments, UUIDs and known prefixes.
    [
      "https://actions.zapier.com/mcp/sk-ak-1a2B3c4D5e6F7g8H/sse",
      `https://actions.zapier.com/mcp/${M}/sse`,
    ],
    [
      "https://hooks.slack.com/services/T0000/B0000/a1B2c3D4e5F6g7H8i9J0k1L2",
      `https://hooks.slack.com/services/T0000/B0000/${M}`,
    ],
    [
      "https://server.example.ai/123e4567-e89b-12d3-a456-426614174000/mcp",
      `https://server.example.ai/${M}/mcp`,
    ],
    // A token in the fragment (OAuth implicit flow).
    ["https://app.dev/cb#access_token=abc&state=1", `https://app.dev/cb#access_token=${M}&state=1`],
  ])("%s", (url, want) => {
    expect(redactUrl(url)).toBe(want);
  });

  it.each([
    "https://api.githubcopilot.com/mcp/",
    "https://mcp.example.com/v1/sse?team=core&region=eu-west-1",
    "http://localhost:3000/mcp",
    "https://x.dev/@modelcontextprotocol/server-filesystem-2024",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell syntax under test
    "https://x.dev/${ORG}/mcp",
    "not a url",
  ])("leaves %s as it is", (url) => {
    expect(redactUrl(url)).toBe(url);
  });
});

describe("redactArgs", () => {
  it.each<[string[], string[]]>([
    [
      ["-y", "@modelcontextprotocol/server-postgres"],
      ["-y", "@modelcontextprotocol/server-postgres"],
    ],
    // The value after a secret flag.
    [
      ["--api-key", "abc123", "--port", "80"],
      ["--api-key", M, "--port", "80"],
    ],
    [
      ["--token", "t", "--password", "p", "--secret", "s", "--auth", "a", "--key", "k", "-k", "x"],
      ["--token", M, "--password", M, "--secret", M, "--auth", M, "--key", M, "-k", M],
    ],
    [
      ["--access-token", "a", "--client_secret", "b", "--github-token", "c"],
      ["--access-token", M, "--client_secret", M, "--github-token", M],
    ],
    // A secret flag followed by another flag hides nothing.
    [
      ["--auth", "--verbose"],
      ["--auth", "--verbose"],
    ],
    // `--flag=value` forms.
    [
      ["--token=abc", "--api_key=xyz", "--name=shop"],
      [`--token=${M}`, `--api_key=${M}`, "--name=shop"],
    ],
    // Assignments whose name looks secret.
    [
      ["GITHUB_TOKEN=ghp_x", "API_KEY=1", "DB_PASSWORD=2", "client_secret=3", "MODE=dev"],
      [`GITHUB_TOKEN=${M}`, `API_KEY=${M}`, `DB_PASSWORD=${M}`, `client_secret=${M}`, "MODE=dev"],
    ],
    // URLs go through redactUrl, also as a flag value.
    [
      ["postgresql://u:p@localhost/db", "--url=https://x.dev/sse?key=1"],
      [`postgresql://${M}@localhost/db`, `--url=https://x.dev/sse?key=${M}`],
    ],
    // Bare tokens in known formats.
    [
      [
        "sk-ant-api03-abcdefghijkl",
        "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
        "xoxb-1234-5678-abcdefgh",
        "AKIAIOSFODNN7EXAMPLE",
        "0123456789abcdef0123456789abcdef",
        "dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgdmFsdWU9",
      ],
      [M, M, M, M, M, M, M],
    ],
    // Environment references stay: they are how people keep secrets out of config.
    [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell syntax under test
      ["--api-key", "${API_KEY}", "--token=$TOKEN", "--header", "Authorization: Bearer ${T}"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell syntax under test
      ["--api-key", "${API_KEY}", "--token=$TOKEN", "--header", "Authorization: Bearer ${T}"],
    ],
    // Ordinary long words and paths stay readable.
    [
      ["/usr/local/lib/node_modules/@scope/server-filesystem/dist/index.js", "--allow-write"],
      ["/usr/local/lib/node_modules/@scope/server-filesystem/dist/index.js", "--allow-write"],
    ],
  ])("%j", (args, want) => {
    expect(redactArgs(args)).toEqual(want);
  });

  it("does not change the array it is given", () => {
    const args = ["--token", "abc"];
    redactArgs(args);
    expect(args).toEqual(["--token", "abc"]);
  });
});

describe("redactText", () => {
  it.each([
    [
      'curl -s -H "Authorization: Bearer abc.def-123" https://x.dev/hook',
      `curl -s -H "Authorization: Bearer ${M}" https://x.dev/hook`,
    ],
    ["notify --token s3cr3t --title done", `notify --token ${M} --title done`],
    ["notify --api-key=s3cr3t", `notify --api-key=${M}`],
    ["tool --auth --api-key s3cr3t", `tool --auth --api-key ${M}`],
    ["API_KEY=sk-live-abcdefgh123 node hook.js", `API_KEY=${M} node hook.js`],
    ["node hook.js sk-ant-abcdefgh12345", `node hook.js ${M}`],
    [
      "curl https://ana:pw@x.dev/h?token=1 && echo ok",
      `curl https://${M}@x.dev/h?token=${M} && echo ok`,
    ],
    ["echo ghp_abcdefghijklmnopqrstuvwxyz0123456789", `echo ${M}`],
    ["curl -u ana:pw https://x.dev", `curl -u ${M} https://x.dev`],
    ['mcp-remote --header "X-API-Key: abc123"', `mcp-remote --header "X-API-Key: ${M}"`],
  ])("%s", (text, want) => {
    expect(redactText(text)).toBe(want);
  });

  it.each([
    "~/bin/notify.sh",
    "npx prettier --check",
    'jq -r ".tool_input.command" | grep -q "rm -rf" && exit 2',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell syntax under test
    "bash ${CLAUDE_PROJECT_DIR}/.claude/hooks/format-on-save.sh",
    "curl -k https://localhost:8443/health",
    "python3 /Users/ana/code/shop/scripts/check_migrations_20240101.py",
    // Environment references are not secrets, and show where the secret comes from.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell syntax under test
    'curl -H "Authorization: Bearer ${API_TOKEN}" --token $TOKEN https://x.dev',
  ])("keeps %s readable", (text) => {
    expect(redactText(text)).toBe(text);
  });
});
