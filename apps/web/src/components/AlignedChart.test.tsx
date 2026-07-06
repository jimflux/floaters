import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import AlignedChart from "./AlignedChart";

describe("AlignedChart solid/dashed split (regression for split point moving on cash-basis)", () => {
  it("ends the solid historical line at the previous month, not the current (projected) month", () => {
    const { container } = render(
      <AlignedChart
        months={["2026-04", "2026-05", "2026-06", "2026-07"]}
        closingBalance={[1000, 2000, 3000, 4000]}
        currentMonthIndex={2}
        formatMonth={(m) => m}
      />
    );

    // The area fill path has a real fill; the historical and projected
    // lines both have fill="none", which isolates them from the area.
    const linePaths = Array.from(
      container.querySelectorAll<SVGPathElement>('svg path[fill="none"]')
    );
    expect(linePaths).toHaveLength(2);

    const dashedPath = linePaths.find(
      (p) => p.getAttribute("stroke-dasharray") === "6 3"
    );
    const solidPath = linePaths.find(
      (p) => p.getAttribute("stroke-dasharray") !== "6 3"
    );

    expect(solidPath).toBeDefined();
    expect(dashedPath).toBeDefined();
    expect(solidPath!.getAttribute("stroke-width")).toBe("2");
    expect(solidPath!.hasAttribute("stroke-dasharray")).toBe(false);

    const solidD = solidPath!.getAttribute("d")!.trim();
    const dashedD = dashedPath!.getAttribute("d")!.trim();

    // currentMonthIndex is 2 (colWidth 100 -> point x = i*100+50), so the
    // current month's closing is a projected month-end: the solid line must
    // stop at the PREVIOUS month's point (x=150), not the current month's
    // (x=250).
    expect(solidD).toMatch(/L 150 [\d.-]+$/);
    expect(solidD).not.toContain("250");

    // The dashed (projected) line picks up from that same previous-month
    // point and continues through the current and future months.
    expect(dashedD).toMatch(/^M 150 [\d.-]+/);
    expect(dashedD).toContain("L 250");
    expect(dashedD).toMatch(/L 350 [\d.-]+$/);
  });
});

describe("AlignedChart two-series geometry (committed vs optimistic)", () => {
  it("shares the previous-month anchor and diverges only from the current month onward", () => {
    const { container, getByTestId } = render(
      <AlignedChart
        months={["2026-04", "2026-05", "2026-06", "2026-07"]}
        closingBalance={[1000, 2000, 3000, 4000]}
        optimisticClosing={[1000, 2000, 3500, 5000]}
        currentMonthIndex={2}
        formatMonth={(m) => m}
      />
    );

    const optLine = getByTestId("optimistic-line");
    const optD = optLine.getAttribute("d")!.trim();
    // Starts at the shared previous-month anchor (x=150, committed y),
    // because history is identical for both series.
    const committedLines = Array.from(
      container.querySelectorAll<SVGPathElement>('svg path[fill="none"]')
    ).filter((p) => p !== optLine);
    const dashed = committedLines.find((p) => p.getAttribute("stroke-dasharray") === "6 3")!;
    const committedStart = dashed.getAttribute("d")!.trim().match(/^M 150 ([\d.]+)/)![1];
    expect(optD).toMatch(new RegExp(`^M 150 ${committedStart}`));
    // ...and runs through the current (x=250) and future (x=350) months.
    expect(optD).toContain("L 250");
    expect(optD).toMatch(/L 350 [\d.-]+$/);

    // The band between the series exists.
    expect(getByTestId("optimistic-band")).toBeTruthy();
    // Legend labels both lines.
    expect(container.textContent).toContain("Committed");
    expect(container.textContent).toContain("If projections land");
  });

  it("renders no band, optimistic line, or legend when the series are identical", () => {
    const { container, queryByTestId } = render(
      <AlignedChart
        months={["2026-05", "2026-06", "2026-07"]}
        closingBalance={[1000, 2000, 3000]}
        optimisticClosing={[1000, 2000, 3000]}
        currentMonthIndex={1}
        formatMonth={(m) => m}
      />
    );
    expect(queryByTestId("optimistic-line")).toBeNull();
    expect(queryByTestId("optimistic-band")).toBeNull();
    expect(container.textContent).not.toContain("If projections land");
    // No NaN anywhere in any path geometry.
    for (const p of Array.from(container.querySelectorAll("svg path"))) {
      expect(p.getAttribute("d")).not.toContain("NaN");
    }
  });
});
