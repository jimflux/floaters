import { describe, it, expect } from "vitest";
import {
  rollupTime,
  localDate,
  weekStart,
  entrySeconds,
  isRunning,
  resolveClientLink,
  NO_CLIENT_NAME,
  type EntryRow,
  type ProjectRow,
  type ClientRow,
} from "./rollup";

const TZ = "Europe/London";
const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
// A Wednesday, 15:00 BST.
const now = new Date("2026-09-09T14:00:00Z");

const clients: ClientRow[] = [
  { toggl_id: 1, name: "Acme Ltd", client_key: null },
  { toggl_id: 2, name: "IKEA", client_key: "contact:ikea-xero" },
];
const projects: ProjectRow[] = [
  { toggl_id: 10, toggl_client_id: 1, name: "Acme retainer", active: true, billable: true, rate: 90, currency: "GBP", color: "#123" },
  { toggl_id: 11, toggl_client_id: 2, name: "IKEA Way", active: true, billable: true, rate: null, currency: null, color: null },
  { toggl_id: 12, toggl_client_id: null, name: "Admin", active: true, billable: false, rate: null, currency: null, color: null },
];

function entry(over: Partial<EntryRow> & { toggl_id: number; start: string }): EntryRow {
  return {
    project_id: null,
    description: null,
    stop: null,
    duration_seconds: 3600,
    billable: false,
    tags: [],
    deleted_at: null,
    ...over,
  };
}

describe("localDate / weekStart", () => {
  it("buckets a late-evening BST entry into its local day, not the UTC day", () => {
    // 23:30 BST on 31 Aug = 22:30Z on 31 Aug; 00:30 BST on 1 Sep = 23:30Z on 31 Aug.
    expect(localDate("2026-08-31T22:30:00Z", TZ)).toBe("2026-08-31");
    expect(localDate("2026-08-31T23:30:00Z", TZ)).toBe("2026-09-01");
  });

  it("finds the Monday of the local week", () => {
    expect(weekStart("2026-09-09T14:00:00Z", TZ)).toBe("2026-09-07"); // Wednesday -> Monday
    expect(weekStart("2026-09-07T08:00:00Z", TZ)).toBe("2026-09-07"); // Monday stays
    expect(weekStart("2026-09-13T08:00:00Z", TZ)).toBe("2026-09-07"); // Sunday -> previous Monday
  });
});

describe("entrySeconds / isRunning", () => {
  it("uses the stored duration when the entry has stopped", () => {
    expect(entrySeconds({ start: "2026-09-09T10:00:00Z", stop: "2026-09-09T11:00:00Z", duration_seconds: 3600 }, now)).toBe(3600);
  });

  it("computes a live duration for a running entry", () => {
    const e = { start: "2026-09-09T13:30:00Z", stop: null, duration_seconds: null, deleted_at: null };
    expect(isRunning(e)).toBe(true);
    expect(entrySeconds(e, now)).toBe(1800);
  });

  it("never treats a deleted entry as running", () => {
    expect(isRunning({ stop: null, duration_seconds: null, deleted_at: "2026-09-01T00:00:00Z" })).toBe(false);
  });
});

describe("resolveClientLink", () => {
  const options = [
    { clientKey: "contact:acme-xero", clientName: "ACME Ltd" },
    { clientKey: "label:west hill cc", clientName: "West Hill CC" },
  ];

  it("prefers an explicit link", () => {
    expect(resolveClientLink({ toggl_id: 2, name: "IKEA", client_key: "contact:ikea-xero" }, options)).toEqual({
      clientKey: "contact:ikea-xero",
      linkSource: "manual",
    });
  });

  it("matches by normalised name", () => {
    expect(resolveClientLink({ toggl_id: 1, name: "  acme   ltd ", client_key: null }, options)).toEqual({
      clientKey: "contact:acme-xero",
      linkSource: "auto",
    });
  });

  it("matches a label-keyed pipeline client by key form", () => {
    expect(resolveClientLink({ toggl_id: 3, name: "West Hill  CC", client_key: null }, options).clientKey).toBe("label:west hill cc");
  });

  it("leaves an unknown client unlinked", () => {
    expect(resolveClientLink({ toggl_id: 4, name: "Nobody", client_key: null }, options)).toEqual({ clientKey: null, linkSource: null });
  });
});

describe("rollupTime", () => {
  const entries: EntryRow[] = [
    // Acme: 2h billable in Aug, 1.5h billable in Sep (today), 1h non-billable Sep
    entry({ toggl_id: 100, project_id: 10, start: "2026-08-12T09:00:00Z", stop: "2026-08-12T11:00:00Z", duration_seconds: 7200, billable: true }),
    entry({ toggl_id: 101, project_id: 10, start: "2026-09-09T08:00:00Z", stop: "2026-09-09T09:30:00Z", duration_seconds: 5400, billable: true }),
    entry({ toggl_id: 102, project_id: 10, start: "2026-09-08T08:00:00Z", stop: "2026-09-08T09:00:00Z", duration_seconds: 3600, billable: false }),
    // IKEA: running since 13:00Z today (1h at `now`)
    entry({ toggl_id: 103, project_id: 11, start: "2026-09-09T13:00:00Z", stop: null, duration_seconds: null, billable: true, description: "Facilitation" }),
    // Admin project, no client: 30m in Sep
    entry({ toggl_id: 104, project_id: 12, start: "2026-09-01T08:00:00Z", stop: "2026-09-01T08:30:00Z", duration_seconds: 1800 }),
    // No project at all: 15m in Sep
    entry({ toggl_id: 105, project_id: null, start: "2026-09-02T08:00:00Z", stop: "2026-09-02T08:15:00Z", duration_seconds: 900 }),
    // Deleted: must be ignored entirely
    entry({ toggl_id: 106, project_id: 10, start: "2026-09-03T08:00:00Z", duration_seconds: 36000, deleted_at: "2026-09-03T10:00:00Z" }),
    // Outside the window: counts toward nothing
    entry({ toggl_id: 107, project_id: 10, start: "2026-05-03T08:00:00Z", duration_seconds: 36000 }),
    // Late-evening BST entry on 31 Aug (22:30Z) stays in August
    entry({ toggl_id: 108, project_id: 10, start: "2026-08-31T22:30:00Z", stop: "2026-08-31T23:00:00Z", duration_seconds: 1800, billable: true }),
  ];

  const linkOptions = [{ clientKey: "contact:acme-xero", clientName: "Acme Ltd" }];
  const invoiced = new Map([["contact:acme-xero", new Map([["2026-09", 500]])]]);

  const result = rollupTime({ entries, projects, clients, months, now, timeZone: TZ, linkOptions, invoicedByClientMonth: invoiced });

  it("rolls hours up by Toggl client per month, billable split out", () => {
    const acme = result.clients.find((c) => c.togglClientId === 1)!;
    expect(acme.hours).toEqual([0, 2.5, 2.5, 0]);
    expect(acme.billableHours).toEqual([0, 2.5, 1.5, 0]);
    const ikea = result.clients.find((c) => c.togglClientId === 2)!;
    expect(ikea.hours).toEqual([0, 0, 1, 0]);
  });

  it("puts project-less and client-less entries in one trailing 'No client' bucket", () => {
    const last = result.clients[result.clients.length - 1];
    expect(last.togglClientId).toBeNull();
    expect(last.clientName).toBe(NO_CLIENT_NAME);
    expect(last.hours).toEqual([0, 0, 0.75, 0]);
    expect(last.projects.map((p) => p.name).sort()).toEqual(["Admin", "No project"]);
  });

  it("totals match the client rows", () => {
    expect(result.totals.hours).toEqual([0, 2.5, 4.25, 0]);
    expect(result.totals.billableHours).toEqual([0, 2.5, 2.5, 0]);
  });

  it("links clients to pipeline keys and carries the invoiced ex-VAT series", () => {
    const acme = result.clients.find((c) => c.togglClientId === 1)!;
    expect(acme.clientKey).toBe("contact:acme-xero");
    expect(acme.linkSource).toBe("auto");
    expect(acme.invoicedExVat).toEqual([0, 0, 500, 0]);
    const ikea = result.clients.find((c) => c.togglClientId === 2)!;
    expect(ikea.linkSource).toBe("manual");
    expect(ikea.invoicedExVat).toEqual([0, 0, 0, 0]);
    expect(result.clients[result.clients.length - 1].invoicedExVat).toBeUndefined();
  });

  it("reports the running entry and today's / this week's hours", () => {
    expect(result.running).toEqual({
      togglId: 103,
      description: "Facilitation",
      projectName: "IKEA Way",
      clientName: "IKEA",
      startedAt: "2026-09-09T13:00:00.000Z",
      billable: true,
    });
    expect(result.todayHours).toBe(2.5); // 1.5h Acme + 1h running IKEA
    expect(result.weekHours).toBe(3.5); // + Tuesday's 1h; the 1 Sep / 2 Sep entries are last week
  });

  it("breaks each client down by project", () => {
    const acme = result.clients.find((c) => c.togglClientId === 1)!;
    expect(acme.projects).toHaveLength(1);
    expect(acme.projects[0]).toMatchObject({ togglProjectId: 10, name: "Acme retainer", rate: 90, currency: "GBP", billable: true });
    expect(acme.projects[0].hours).toEqual(acme.hours);
  });

  it("returns no rows and zero totals with nothing synced", () => {
    const empty = rollupTime({ entries: [], projects: [], clients: [], months, now, timeZone: TZ, linkOptions: [] });
    expect(empty.clients).toEqual([]);
    expect(empty.totals.hours).toEqual([0, 0, 0, 0]);
    expect(empty.running).toBeNull();
  });
});
