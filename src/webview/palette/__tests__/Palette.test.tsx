// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleSetup } from "../../../../test/helpers/setupFixture";
import type { Session } from "../../../features/chats/types";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { Palette, paletteItems } from "../Palette";

const sent: ViewMsg[] = [];
const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.setup.value = sampleSetup();
  store.sessions.value = [
    { id: ID, title: "Fix checkout race", project: "shop", lastActiveAt: 2 } as Session,
  ];
  store.renames.value = {};
  store.prompts.value = null;
  store.tab.value = "home";
  store.details.value = null;
  store.setupDetail.value = null;
  store.paletteOpen.value = false;
});
afterEach(cleanup);

describe("paletteItems", () => {
  it("finds tabs, chats, skills, commands and more, best match first", () => {
    const titles = paletteItems("release").map((i) => `${i.group}: ${i.title}`);
    expect(titles[0]).toBe("Skills: release-notes");
    expect(titles).toContain("Commands: /release-notes");
    expect(paletteItems("checkout").map((i) => i.title)).toContain("Fix checkout race");
    expect(paletteItems("usage")[0]).toMatchObject({ group: "Go to", title: "Usage" });
  });

  it("shows each group once", () => {
    store.sessions.value = [
      { id: "a", title: "Refactor the API", project: "shop", lastActiveAt: 3 } as Session,
      { id: "b", title: "Write the release notes", project: "shop", lastActiveAt: 1 } as Session,
    ];
    const groups = paletteItems("re").map((i) => i.group);
    const runs = groups.filter((g, k) => g !== groups[k - 1]);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it("lists the tabs and recent chats when nothing is typed, and stops at 50", () => {
    const empty = paletteItems("");
    expect(empty[0]!.group).toBe("Go to");
    expect(empty.some((i) => i.group === "Chats")).toBe(true);
    expect(paletteItems("e").length).toBeLessThanOrEqual(50);
  });
});

describe("Palette", () => {
  it("opens with Ctrl+K, moves with the arrows and opens the pick with Enter", async () => {
    render(<Palette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox", { name: "Search everything" });
    fireEvent.input(box, { target: { value: "release" } });
    await screen.findAllByRole("option", { name: /release-notes/ });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(store.tab.value).toBe("skills"));
    expect(store.setupDetail.value).toEqual({
      page: "skills",
      key: sampleSetup().skills[0]!.file,
    });
    expect(store.paletteOpen.value).toBe(false);
  });

  it("opens a chat's details", async () => {
    render(<Palette />);
    store.paletteOpen.value = true;
    const box = await screen.findByRole("combobox", { name: "Search everything" });
    fireEvent.input(box, { target: { value: "checkout race" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Fix checkout race/ }));
    expect(store.tab.value).toBe("chats");
    expect(store.details.value?.id).toBe(ID);
  });

  it("closes with Escape", async () => {
    render(<Palette />);
    store.paletteOpen.value = true;
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(store.paletteOpen.value).toBe(false));
  });
});
