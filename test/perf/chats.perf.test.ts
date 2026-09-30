import { describe, expect, it } from "vitest";
import { listSessions } from "../../src/features/chats/reader";
import { L, writeSession } from "../helpers/fakeHome";
import { useTmpDir } from "../helpers/tmp";

const tmp = useTmpDir();

// Speed budgets run in their own, non-parallel suite (npm run test:perf) so disk
// contention from other test files cannot make them flaky.
describe("performance", () => {
  it("lists 2 000 chats quickly", async () => {
    const home = tmp();
    for (let i = 0; i < 2000; i++) {
      writeSession(home, `/code/p${i % 40}`, (c) => [
        L.user(c, `task ${i}`),
        L.assistant(c),
        L.aiTitle(c, `Task ${i}`),
      ]);
    }
    const t0 = performance.now();
    const all = await listSessions(home);
    const ms = performance.now() - t0;
    expect(all).toHaveLength(2000);
    expect(ms).toBeLessThan(2500);
  });
});
