import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// index.ts connects a stdio transport on import, so assert against the source.
// String assertions keep the tool descriptions honest about the pipeline
// semantics agent consumers rely on (plan U8).
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
  "utf8"
);

describe("MCP tool registration", () => {
  it("registers the pipeline tool alongside the existing four", () => {
    for (const tool of [
      "get_cashflow",
      "get_income_pipeline",
      "get_connection",
      "get_forecast",
      "list_transactions",
    ]) {
      expect(src).toContain(`"${tool}"`);
    }
    expect(src).toContain('apiGet("/api/pipeline")');
  });

  it("describes the committed/optimistic semantics on get_cashflow", () => {
    const desc = src.slice(src.indexOf('"get_cashflow"'), src.indexOf('"get_income_pipeline"'));
    expect(desc).toMatch(/committed/);
    expect(desc).toMatch(/optimistic/);
    expect(desc).toMatch(/paid/);
    expect(desc).toMatch(/invoiced/);
    expect(desc).toMatch(/projected/);
    expect(desc).toMatch(/UNASSIGNED/);
  });

  it("keeps the cashflow window bounds mirroring the API (back ≤ 12, forward ≤ 24)", () => {
    const cashflow = src.slice(src.indexOf('"get_cashflow"'), src.indexOf('"get_income_pipeline"'));
    expect(cashflow).toMatch(/\.max\(12\)/);
    expect(cashflow).toMatch(/\.max\(24\)/);
  });

  it("flags get_forecast as predating the pipeline", () => {
    const forecast = src.slice(src.indexOf('"get_forecast"'), src.indexOf('"list_transactions"'));
    expect(forecast).toMatch(/predates the income pipeline/);
  });
});
