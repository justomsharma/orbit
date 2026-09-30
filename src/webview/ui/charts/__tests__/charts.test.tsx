// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { BarChart } from "../BarChart";
import { Heatmap } from "../Heatmap";
import { Meter } from "../Meter";
import { RankList } from "../RankList";
import { StatTile } from "../StatTile";

afterEach(cleanup);

const days = Array.from({ length: 30 }, (_, i) => ({
  key: `2026-09-${String(i + 1).padStart(2, "0")}`,
  label: `Sep ${i + 1}`,
  value: i === 29 ? 0 : (i % 7) + 1,
  display: `$${(i % 7) + 1}.00`,
}));

describe("BarChart", () => {
  it("draws one bar per day with a zero-height bar for empty days", () => {
    const { container } = render(<BarChart title="Cost per day" data={days} />);
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(30);
  });

  it("shows the day and value when a bar is hovered", () => {
    const { container } = render(<BarChart title="Cost per day" data={days} />);
    const hit = container.querySelectorAll("[data-hit]")[2]!;
    fireEvent.mouseEnter(hit);
    expect(screen.getByRole("tooltip").textContent).toContain("Sep 3");
    expect(screen.getByRole("tooltip").textContent).toContain("$3.00");
    fireEvent.mouseLeave(hit);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("has a text alternative: a summary and a data table", () => {
    render(<BarChart title="Cost per day" data={days} />);
    expect(screen.getByRole("img", { name: /Cost per day/ })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Cost per day" }).querySelectorAll("tr").length).toBe(
      31,
    );
  });

  it("renders a calm empty state when every value is zero", () => {
    render(<BarChart title="Cost per day" data={days.map((d) => ({ ...d, value: 0 }))} />);
    expect(screen.getByText(/No usage in this period/)).toBeTruthy();
  });
});

describe("Heatmap", () => {
  const cells = Array.from({ length: 26 * 7 }, (_, i) => ({
    day: `d${i}`,
    label: `Day ${i}`,
    value: i % 5,
    display: `${i % 5}K tokens`,
  }));

  it("draws 26 weeks × 7 days of cells in five steps", () => {
    const { container } = render(<Heatmap title="Activity" cells={cells} />);
    const rects = container.querySelectorAll("[data-cell]");
    expect(rects).toHaveLength(182);
    const steps = new Set([...rects].map((r) => r.getAttribute("data-step")));
    expect([...steps].sort()).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("tells the day and amount on hover", () => {
    const { container } = render(<Heatmap title="Activity" cells={cells} />);
    fireEvent.mouseEnter(container.querySelectorAll("[data-cell]")[3]!);
    expect(screen.getByRole("tooltip").textContent).toBe("Day 3 · 3K tokens");
  });
});

describe("Meter", () => {
  it("shows percent, reset time and a warning in words, not just colour", () => {
    const now = Date.now();
    render(
      <Meter label="5-hour limit" pct={82} resetsAt={now + 2 * 3600_000 + 60_000} now={now} />,
    );
    const bar = screen.getByLabelText("5-hour limit");
    expect(bar.getAttribute("aria-valuenow")).toBe("82");
    expect(screen.getByText("82%")).toBeTruthy();
    expect(screen.getByText(/Resets in 2h 1m/)).toBeTruthy();
    expect(screen.getByText(/Getting close/)).toBeTruthy();
  });

  it("clamps the fill but reports the real number above 100%", () => {
    const { container } = render(<Meter label="Spend" pct={130} resetsAt={0} now={1} />);
    expect((container.querySelector(".meter-fill") as HTMLElement).style.width).toBe("100%");
    expect(screen.getByText("130%")).toBeTruthy();
    expect(screen.getByText(/Limit reached/)).toBeTruthy();
  });
});

describe("StatTile", () => {
  it("shows label, value and a signed delta", () => {
    render(
      <StatTile
        label="Cost today"
        value="$4.20"
        delta={{ text: "+$1.10 vs yesterday", up: true }}
      />,
    );
    expect(screen.getByText("Cost today")).toBeTruthy();
    expect(screen.getByText("$4.20")).toBeTruthy();
    expect(screen.getByText("+$1.10 vs yesterday")).toBeTruthy();
  });
});

describe("RankList", () => {
  it("lists items with values and proportional bars, largest first as given", () => {
    const { container } = render(
      <RankList
        title="By project"
        items={[
          { key: "a", label: "shop", value: 30, display: "$30" },
          { key: "b", label: "api", value: 10, display: "$10" },
        ]}
      />,
    );
    const bars = [...container.querySelectorAll(".rank-bar-fill")] as HTMLElement[];
    expect(bars.map((b) => b.style.width)).toEqual(["100%", "33.3%"]);
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.getByText("$10")).toBeTruthy();
  });
});
