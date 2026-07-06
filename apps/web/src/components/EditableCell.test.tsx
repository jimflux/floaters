import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import EditableCell from "./EditableCell";
import type { CashflowData } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const setOverride = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api", () => ({
  setProjectionOverride: (...args: unknown[]) => setOverride(...args),
  removeProjectionOverride: vi.fn().mockResolvedValue(undefined),
}));

function seedData(): CashflowData {
  return {
    currentBalance: 0,
    fallsBelowZeroIn: null,
    currentMonthIndex: 1,
    months: ["2026-05", "2026-06", "2026-07"],
    cashIn: [],
    cashOut: [
      {
        accountCode: "400",
        accountName: "Advertising",
        monthly: [100, 100, 100],
        isProjected: [false, false, true],
        hasOverride: [false, false, false],
      },
    ],
    openingBalance: [0, 0, 0],
    closingBalance: [0, 0, 0],
    netCashMovement: [0, 0, 0],
    accounts: [],
  };
}

function renderCell(qc: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <EditableCell
      value={100}
      accountCode="400"
      month="2026-07"
      isProjected
      hasOverride={false}
      isCurrentMonth={false}
      months={["2026-05", "2026-06", "2026-07"]}
      monthIndex={2}
      previousValue={100}
      as="div"
    />,
    { wrapper }
  );
}

describe("EditableCell save (regression for edits looking unsaved)", () => {
  beforeEach(() => setOverride.mockClear());

  it("calls the API and optimistically patches the cashflow cache so the edit sticks", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["cashflow"], seedData());
    renderCell(qc);

    // Open the popover, type a new value, save.
    fireEvent.click(screen.getByRole("button"));
    const input = await screen.findByRole("spinbutton");
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(setOverride).toHaveBeenCalledWith("400", "2026-07", 5000)
    );

    // The optimistic onMutate patch must be present in the cache (this is what
    // broke before: the value was discarded by an immediate stale refetch).
    const cached = qc.getQueryData<CashflowData>(["cashflow"])!;
    const acct = cached.cashOut.find((a) => a.accountCode === "400")!;
    expect(acct.monthly[2]).toBe(5000);
    expect(acct.hasOverride[2]).toBe(true);
  });
});

describe("EditableCell override pre-fill", () => {
  it("seeds the editor from the stored override, not the blended cell value", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["cashflow"], seedData());
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    // Current-month blend: cell shows 3000 (cash-to-date beat the 2000
    // override). Opening the editor must show the raw override, otherwise
    // open-then-save silently ratchets it up to the blend.
    render(
      <EditableCell
        value={3000}
        accountCode="400"
        month="2026-06"
        isProjected={false}
        hasOverride
        isCurrentMonth
        months={["2026-05", "2026-06", "2026-07"]}
        monthIndex={1}
        overrideAmount={2000}
        as="div"
      />,
      { wrapper }
    );

    fireEvent.click(screen.getByRole("button"));
    const input = await screen.findByRole("spinbutton");
    expect((input as HTMLInputElement).value).toBe("2000");
  });
});
