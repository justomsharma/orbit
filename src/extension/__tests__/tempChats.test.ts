import { describe, expect, it } from "vitest";
import type { Session } from "../../features/chats/types";
import type { ChatSet } from "../state";
import { TempChats } from "../tempChats";

const A = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const B = "11111111-2222-4333-8444-555555555555";
const chat = (id: string, startedAt: number, cwd = "/code/shop") =>
  ({ id, cwd, startedAt }) as Session;

function setup() {
  const sets: Record<ChatSet, Set<string>> = {
    archived: new Set(),
    hidden: new Set(),
    temp: new Set(),
  };
  const t = new TempChats<string>({
    mark: async (set, ids, on) => {
      for (const id of ids) on ? sets[set].add(id) : sets[set].delete(id);
    },
    marked: (set) => [...sets[set]],
    platform: "linux",
  });
  return { t, sets };
}

describe("TempChats", () => {
  it("tags the new chat in that folder as temporary, and hides it when its terminal closes", async () => {
    const { t, sets } = setup();
    t.started("term1", "/code/shop", [B], 1000);
    await t.seen([chat(B, 0), chat(A, 1500)]);
    expect([...sets.temp]).toEqual([A]);
    await t.closed("term1");
    expect([...sets.hidden]).toEqual([A]);
  });

  it("keeps a chat made permanent", async () => {
    const { t, sets } = setup();
    t.started("term1", "/code/shop", [], 1000);
    await t.seen([chat(A, 1500)]);
    sets.temp.delete(A); // Make permanent
    await t.closed("term1");
    expect([...sets.hidden]).toEqual([]);
  });

  it("ignores chats in other folders or from before it started", async () => {
    const { t, sets } = setup();
    t.started("term1", "/code/shop", [], 10_000);
    await t.seen([chat(A, 1500), chat(B, 12_000, "/code/api")]);
    expect([...sets.temp]).toEqual([]);
  });

  it("after a restart, hides temporary chats that stopped", async () => {
    const { t, sets } = setup();
    sets.temp.add(A).add(B);
    await t.sweep([B]);
    expect([...sets.hidden]).toEqual([A]);
  });
});
