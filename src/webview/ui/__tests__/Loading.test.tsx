// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import { Loading } from "../Loading";

const sent: ViewMsg[] = [];

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Loading", () => {
  it("says what it's reading, then offers to try again when it takes long", () => {
    render(<Loading text="Reading your setup…" retry={{ type: "setup:refresh" }} />);
    expect(screen.getByRole("status").textContent).toBe("Reading your setup…");
    expect(screen.queryByRole("button")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText(/Still reading/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(sent).toEqual([{ type: "setup:refresh" }]);
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText(/taking much longer than usual/)).toBeTruthy();
  });
});
