// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import { Guard } from "../Guard";

const sent: ViewMsg[] = [];
let broken = true;

function Boom() {
  if (broken) throw new Error("kaboom at C:\\Users\\ana\\secret");
  return <p>All good</p>;
}

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  broken = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Guard", () => {
  it("shows what to do instead of a blank tab, and tells the host", () => {
    render(
      <Guard name="Usage">
        <Boom />
      </Guard>,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/Usage hit a problem/);
    expect(sent).toContainEqual({
      type: "viewError",
      where: "Usage",
      message: expect.stringContaining("kaboom"),
    });
  });

  it("tries again, and offers to report it", () => {
    render(
      <Guard name="Usage">
        <Boom />
      </Guard>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(sent).toContainEqual({ type: "orbitCommand", id: "reportProblem" });
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("All good")).toBeTruthy();
  });

  it("renders its children when nothing breaks", () => {
    function Fine() {
      const [n] = useState(1);
      return <p>n={n}</p>;
    }
    render(
      <Guard name="Home">
        <Fine />
      </Guard>,
    );
    expect(screen.getByText("n=1")).toBeTruthy();
  });
});
