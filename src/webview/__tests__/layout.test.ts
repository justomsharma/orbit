import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = ["styles.css", "styles-usage.css", "styles-setup.css", "styles-chats.css"]
  .map((f) => readFileSync(join(__dirname, "..", f), "utf8"))
  .join("\n");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

// Layout can't be measured in happy-dom, so these pin the CSS that keeps the page itself
// from ever scrolling (which slid the tab bar off the top and left the bottom empty).
describe("layout guards", () => {
  it("every scrolling tab contains its own absolutely positioned bits (screen-reader text)", () => {
    expect(rule(".scroll")).toMatch(/position:\s*relative/);
  });

  it("content arriving above the fold doesn't push the view down", () => {
    expect(rule(".scroll")).toMatch(/overflow-anchor:\s*none/);
  });

  it("the page itself can't be scrolled, even by scrollIntoView", () => {
    expect(rule("html, body, #root")).toMatch(/overflow:\s*clip/);
  });

  it("a chat's hover buttons sit beside its title, never on top of it", () => {
    expect(rule(".chat-actions")).not.toMatch(/position:\s*absolute/);
    expect(rule(".chat-actions")).toMatch(/flex:\s*none/);
  });
});
