import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import TimeSection from "./TimeSection";
import { formatHours, cellTitle, monthIndexer } from "@/lib/time";
import type { TimeTrackingResponse, TimeClient } from "@/lib/types";

const months = ["2026-08", "2026-09", "2026-10"];

function client(over: Partial<TimeClient> = {}): TimeClient {
  return {
    togglClientId: 1,
    clientName: "Acme",
    clientKey: "contact:acme",
    linkSource: "auto",
    hours: [10, 4.25, 0],
    billableHours: [8, 4.25, 0],
    invoicedExVat: [800, 0, 0],
    projects: [],
    ...over,
  };
}

function fixture(over: Partial<TimeTrackingResponse> = {}): TimeTrackingResponse {
  return {
    configured: true,
    lastSyncedAt: "2026-09-13T09:00:00Z",
    syncStatus: "idle",
    syncError: null,
    timeZone: "Europe/London",
    months,
    currentMonthIndex: 1,
    clients: [client(), client({ togglClientId: null, clientName: "No client", clientKey: null, linkSource: null, hours: [0, 0.5, 0], billableHours: [0, 0, 0], invoicedExVat: undefined })],
    totals: { hours: [10, 4.75, 0], billableHours: [8, 4.25, 0] },
    todayHours: 1,
    weekHours: 3,
    running: null,
    linkOptions: [{ clientKey: "contact:acme", clientName: "Acme" }],
    ...over,
  };
}

function renderSection(time: TimeTrackingResponse | undefined, open = true) {
  const onOpenPanel = vi.fn();
  render(
    <table>
      <tbody>
        <TimeSection time={time} months={months} currentMonthIndex={1} open={open} onToggle={() => {}} onOpenPanel={onOpenPanel} />
      </tbody>
    </table>
  );
  return { onOpenPanel };
}

describe("formatHours", () => {
  it("shows whole hours without decimals, blanks zero, rounds to a tenth", () => {
    expect(formatHours(0)).toBe("");
    expect(formatHours(8)).toBe("8h");
    expect(formatHours(4.25)).toBe("4.3h");
    expect(formatHours(0.04)).toBe("");
  });
});

describe("cellTitle", () => {
  it("includes worked, billable, invoiced and the effective rate", () => {
    expect(cellTitle(client(), 0)).toBe("10h worked · 8h billable · £800 invoiced ex VAT · £80/hr");
  });

  it("omits the rate without invoicing and is empty off-window", () => {
    expect(cellTitle(client(), 1)).toBe("4.3h worked · 4.3h billable");
    expect(cellTitle(client(), -1)).toBe("");
  });
});

describe("TimeSection", () => {
  it("renders totals in the header and a row per client", () => {
    renderSection(fixture());
    const header = screen.getByTestId("hours-header");
    expect(within(header).getByText("10h")).toBeInTheDocument();
    expect(within(header).getByText("4.8h")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("No client")).toBeInTheDocument();
    expect(screen.getByTestId("layer-billable")).toBeInTheDocument();
    expect(screen.queryByTestId("running-dot")).not.toBeInTheDocument();
  });

  it("hides the billable subtotal when nothing is flagged billable", () => {
    renderSection(fixture({ totals: { hours: [10, 4.75, 0], billableHours: [0, 0, 0] } }));
    expect(screen.queryByTestId("layer-billable")).not.toBeInTheDocument();
  });

  it("aligns by month key when the time window differs from the grid", () => {
    const at = monthIndexer(fixture({ months: ["2026-07", "2026-08", "2026-09"] }));
    expect(at("2026-08")).toBe(1);
    expect(at("2026-10")).toBe(-1);
  });

  it("shows the running indicator with the entry's context", () => {
    renderSection(fixture({ running: { togglId: 1, description: "Deck", projectName: "Retainer", clientName: "Acme", startedAt: "2026-09-13T08:00:00Z", billable: true } }));
    expect(screen.getByTestId("running-dot")).toHaveAttribute("title", "Timer running: Acme · Retainer · Deck");
  });

  it("explains itself when Toggl is not configured", () => {
    renderSection(fixture({ configured: false, clients: [] }));
    expect(screen.getByText(/Set TOGGL_API_TOKEN/)).toBeInTheDocument();
  });

  it("prompts for a sync when configured but empty", () => {
    renderSection(fixture({ clients: [] }));
    expect(screen.getByText(/No hours synced yet/)).toBeInTheDocument();
  });

  it("renders the header alone while the query is still loading", () => {
    renderSection(undefined);
    expect(screen.getByTestId("hours-header")).toBeInTheDocument();
    expect(screen.getByText(/Toggl not connected/)).toBeInTheDocument();
  });

  it("opens the panel from the clock button without toggling the section", () => {
    const { onOpenPanel } = renderSection(fixture());
    screen.getByTitle("Time tracking: sync and client links").click();
    expect(onOpenPanel).toHaveBeenCalled();
  });
});
