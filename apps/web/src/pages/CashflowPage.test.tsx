import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CashflowData } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

function newShape(): CashflowData {
  return {
    currentBalance: 10000,
    fallsBelowZeroIn: null,
    optimisticFallsBelowZeroIn: null,
    currentMonthIndex: 1,
    months: ["2026-05", "2026-06", "2026-07"],
    income: {
      clients: [
        {
          clientKey: "contact:c1",
          clientName: "IKEA",
          monthly: [0, 0, 45500],
          paid: [0, 0, 0],
          invoiced: [0, 0, 0],
          projected: [0, 0, 45500],
          overdue: [false, false, false],
        },
      ],
      totals: { paid: [0, 0, 0], invoiced: [0, 0, 0], projected: [0, 0, 45500] },
    },
    cashOut: [],
    committedOpening: [10000, 10000, 10000],
    committedClosing: [10000, 10000, 10000],
    committedNet: [0, 0, 0],
    optimisticClosing: [10000, 10000, 55500],
    optimisticNet: [0, 0, 45500],
    accounts: [],
  };
}

const getCashflow = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getCashflow: () => getCashflow(),
    getProjectionOverrides: () => Promise.resolve({ overrides: [] }),
    getPipeline: () =>
      Promise.resolve({ currentMonth: "2026-06", projections: [], unreviewed: [], contacts: [] }),
  };
});

import CashflowPage from "./CashflowPage";
import { CASHFLOW_CACHE_KEY } from "@/lib/api";

beforeEach(() => {
  localStorage.clear();
  getCashflow.mockReset().mockResolvedValue(newShape());
});

describe("CashflowPage cutover safety", () => {
  it("uses a versioned cache key so pre-break payloads can never hydrate the new UI", () => {
    expect(CASHFLOW_CACHE_KEY).not.toBe("cashflow_cache");
  });

  it("ignores a stale pre-break cache under the old key and renders from the fresh fetch", async () => {
    // A v1 payload (cashIn account rows, no income section) under the OLD key:
    // the versioned reader must not pick it up, so the page renders from the
    // network response without throwing.
    localStorage.setItem(
      "cashflow_cache",
      JSON.stringify({
        currentBalance: 1,
        months: ["2026-05"],
        currentMonthIndex: 0,
        cashIn: [{ accountCode: "200", accountName: "Sales", monthly: [93000] }],
        cashOut: [],
        openingBalance: [0],
        closingBalance: [0],
        netCashMovement: [0],
        accounts: [],
      })
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CashflowPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("IKEA")).toBeInTheDocument();
    expect(screen.getByText("↗ Income")).toBeInTheDocument();
    // The fresh payload was cached under the versioned key
    expect(localStorage.getItem(CASHFLOW_CACHE_KEY)).toContain("contact:c1");
  });
});
