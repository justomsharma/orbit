import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { readMarketplaces } from "../marketplaces";
import { put } from "./helpers";

const tmp = useTmpDir();

describe("readMarketplaces", () => {
  it("lists where plugins come from, marking Anthropic's own", async () => {
    const home = join(tmp(), "claude");
    put(
      home,
      "plugins/known_marketplaces.json",
      JSON.stringify({
        "claude-plugins-official": {
          source: { source: "github", repo: "anthropics/claude-plugins-official" },
          lastUpdated: "2026-10-01T14:56:43.166Z",
        },
        team: { source: { source: "git", url: "https://git.example.com/team/plugins.git" } },
        local: { source: { source: "directory", path: "/home/ana/plugins" } },
        odd: "not an object",
      }),
    );
    expect(await readMarketplaces(home)).toEqual([
      {
        name: "claude-plugins-official",
        source: "github.com/anthropics/claude-plugins-official",
        official: true,
        lastUpdated: Date.parse("2026-10-01T14:56:43.166Z"),
      },
      { name: "local", source: "/home/ana/plugins", official: false, lastUpdated: null },
      {
        name: "team",
        source: "https://git.example.com/team/plugins.git",
        official: false,
        lastUpdated: null,
      },
    ]);
  });

  it("is empty when Claude has none", async () => {
    expect(await readMarketplaces(tmp())).toEqual([]);
  });
});
