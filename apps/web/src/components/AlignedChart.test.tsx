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
