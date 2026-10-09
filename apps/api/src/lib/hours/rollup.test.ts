import { describe, it, expect } from "vitest";
import {
  rollupTime,
  listEntries,
  localDate,
  weekStart,
  entrySeconds,
  isRunning,
  resolveClientLink,
  NO_CLIENT_NAME,
} from "./rollup";
import type { BurnBarClient, BurnBarEntry, BurnBarProject } from "./burnbar";

const TZ = "Europe/London";
const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
// A Wednesday, 15:00 BST.
const now = new Date("2026-09-09T14:00:00Z");

const clients: BurnBarClient[] = [
  { id: 68438745, name: "Acme Ltd", archived: false, deleted: false },
  { id: 17580262, name: "IKEA", archived: false, deleted: false },
  // A newer BurnBar-made client, archived since: still named on old entries.
  { id: 10_000_000_001, name: "Old Co", archived: true, deleted: false },
];
const projects: BurnBarProject[] = [
  { id: 10, clientId: 68438745, name: "Acme retainer", archived: false, deleted: false },
  { id: 11, clientId: 17580262, name: "IKEA Way", archived: false, deleted: false },
  { id: 20_000_000_002, clientId: 10_000_000_001, name: "Wind-down", archived: true, deleted: false },
];
// The IKEA link was set by hand in the Toggl days, keyed by the same client id.
const links = new Map([["17580262", "contact:ikea-xero"]]);

let n = 0;
function entry(over: Partial<BurnBarEntry> & { start: string }): BurnBarEntry {
  n += 1;
  return {
    id: `E${String(n).padStart(3, "0")}-UUID`,
    description: null,
    clientId: null,
    projectId: null,
    end: null,
    deleted: false,
    ...over,
  };
}
const hour = (start: string, hours: number) => new Date(Date.parse(start) + hours * 3600_000).toISOString();

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
  it("times a finished entry from start to end", () => {
    expect(entrySeconds({ start: "2026-09-09T10:00:00Z", end: "2026-09-09T11:00:00Z" }, now)).toBe(3600);
  });

  it("times a running entry live from its start", () => {
    const e = { start: "2026-09-09T13:30:00Z", end: null };
    expect(isRunning(e)).toBe(true);
    expect(entrySeconds(e, now)).toBe(1800);
  });

  it("never returns a negative duration", () => {
    expect(entrySeconds({ start: "2026-09-09T11:00:00Z", end: "2026-09-09T10:00:00Z" }, now)).toBe(0);
  });
});

describe("resolveClientLink", () => {
  const options = [
    { clientKey: "contact:acme-xero", clientName: "ACME Ltd" },
    { clientKey: "label:west hill cc", clientName: "West Hill CC" },
  ];

  it("prefers an explicit link", () => {
    expect(resolveClientLink({ name: "IKEA", clientKey: "contact:ikea-xero" }, options)).toEqual({
      clientKey: "contact:ikea-xero",
      linkSource: "manual",
    });
  });

  it("matches by normalised name", () => {
    expect(resolveClientLink({ name: "  acme   ltd " }, options)).toEqual({ clientKey: "contact:acme-xero", linkSource: "auto" });
  });

  it("matches a label-keyed pipeline client by key form", () => {
    expect(resolveClientLink({ name: "West Hill  CC" }, options).clientKey).toBe("label:west hill cc");
  });

  it("leaves an unknown client unlinked", () => {
    expect(resolveClientLink({ name: "Nobody" }, options)).toEqual({ clientKey: null, linkSource: null });
  });

  const legal = [
    { clientKey: "contact:pnet", clientName: "Propellernet Ltd" },
    { clientKey: "contact:edifai", clientName: "Coteam Ltd, trading as Edifai" },
    { clientKey: "contact:elev8", clientName: "Elev-8 Performance Improvement Ltd" },
    { clientKey: "contact:ai-1", clientName: "AI Summit Ltd" },
    { clientKey: "contact:ai-2", clientName: "Summit Partners LLP" },
    { clientKey: "contact:westhill", clientName: "West Hill Community Centre" },
  ];

  it("links a short name that appears whole inside exactly one pipeline name", () => {
    expect(resolveClientLink({ name: "Propellernet" }, legal).clientKey).toBe("contact:pnet");
    expect(resolveClientLink({ name: "edifai" }, legal).clientKey).toBe("contact:edifai");
    expect(resolveClientLink({ name: "Elev-8" }, legal)).toEqual({ clientKey: "contact:elev8", linkSource: "auto" });
  });

  it("never links on a partial word, a too-short name, or an ambiguous containment", () => {
    expect(resolveClientLink({ name: "Hill" }, legal).clientKey).toBe("contact:westhill");
    expect(resolveClientLink({ name: "Propeller" }, legal).clientKey).toBeNull(); // partial word
    expect(resolveClientLink({ name: "AI" }, legal).clientKey).toBeNull(); // too short
    expect(resolveClientLink({ name: "Summit" }, legal).clientKey).toBeNull(); // two candidates
  });
});

describe("rollupTime from BurnBar data", () => {
  const entries: BurnBarEntry[] = [
    // Acme: 2h in Aug, 1.5h on Sep 9 (today), 1h on Sep 8
    entry({ projectId: 10, start: "2026-08-12T09:00:00Z", end: hour("2026-08-12T09:00:00Z", 2) }),
    entry({ projectId: 10, start: "2026-09-09T08:00:00Z", end: hour("2026-09-09T08:00:00Z", 1.5) }),
    entry({ projectId: 10, start: "2026-09-08T08:00:00Z", end: hour("2026-09-08T08:00:00Z", 1) }),
    // IKEA: running since 13:00Z today (1h at `now`)
    entry({ projectId: 11, start: "2026-09-09T13:00:00Z", description: "Facilitation" }),
    // An older running entry alongside it: counts, but is not the one shown
    entry({ clientId: 68438745, start: "2026-09-09T12:30:00Z", description: "Agents" }),
    // Acme, logged against the client with no project: 30m on Sep 1
    entry({ clientId: 68438745, start: "2026-09-01T08:00:00Z", end: hour("2026-09-01T08:00:00Z", 0.5) }),
    // No client and no project: 15m on Sep 2
    entry({ start: "2026-09-02T08:00:00Z", end: hour("2026-09-02T08:00:00Z", 0.25) }),
    // Archived client and project: 1h in July, still named
    entry({ projectId: 20_000_000_002, start: "2026-07-15T08:00:00Z", end: hour("2026-07-15T08:00:00Z", 1) }),
    // A tombstone, if one ever slips through: ignored
    entry({ projectId: 10, start: "2026-09-03T08:00:00Z", end: hour("2026-09-03T08:00:00Z", 10), deleted: true }),
    // Outside the window: counts toward no month
    entry({ projectId: 10, start: "2026-05-03T08:00:00Z", end: hour("2026-05-03T08:00:00Z", 10) }),
    // Late-evening BST entry on 31 Aug (22:30Z) stays in August
    entry({ projectId: 10, start: "2026-08-31T22:30:00Z", end: "2026-08-31T23:00:00Z" }),
    // Logged ahead for tomorrow: not worked yet, so it counts toward nothing
    entry({ projectId: 10, start: "2026-09-10T08:00:00Z", end: "2026-09-10T12:00:00Z" }),
  ];

  const linkOptions = [{ clientKey: "contact:acme-xero", clientName: "Acme Ltd" }];
  const invoiced = new Map([["contact:acme-xero", new Map([["2026-09", 500]])]]);
  const result = rollupTime({
    clients,
    projects,
    entries,
    links,
    months,
    now,
    timeZone: TZ,
    linkOptions,
    invoicedByClientMonth: invoiced,
  });
  const acme = result.clients.find((c) => c.togglClientId === 68438745)!;
  const ikea = result.clients.find((c) => c.togglClientId === 17580262)!;

  it("rolls hours up by client per month, a project's client taken from the project", () => {
    // Sep: 1.5 + 1 + 0.5 (no project) + 1.5 (running since 12:30Z)
    expect(acme.hours).toEqual([0, 2.5, 4.5, 0]);
    expect(ikea.hours).toEqual([0, 0, 1, 0]);
  });

  it("has no billable split: BurnBar has no billable flag", () => {
    expect(acme.billableHours).toEqual([0, 0, 0, 0]);
    expect(result.totals.billableHours).toEqual([0, 0, 0, 0]);
  });

  it("names archived clients and projects from BurnBar's hidden lists", () => {
    const old = result.clients.find((c) => c.togglClientId === 10_000_000_001)!;
    expect(old.clientName).toBe("Old Co");
    expect(old.hours).toEqual([1, 0, 0, 0]);
    expect(old.projects[0]).toMatchObject({ togglProjectId: 20_000_000_002, name: "Wind-down", active: false });
  });

  it("puts entries with no client in one trailing 'No client' bucket", () => {
    const last = result.clients[result.clients.length - 1];
    expect(last.togglClientId).toBeNull();
    expect(last.clientName).toBe(NO_CLIENT_NAME);
    expect(last.hours).toEqual([0, 0, 0.25, 0]);
    expect(last.projects.map((p) => p.name)).toEqual(["No project"]);
    expect(last.invoicedExVat).toBeUndefined();
  });

  it("totals match the client rows", () => {
    expect(result.totals.hours).toEqual([1, 2.5, 5.75, 0]);
  });

  it("links clients by id (carried over from Toggl) or by name, with the invoiced ex-VAT series", () => {
    expect(acme.clientKey).toBe("contact:acme-xero");
    expect(acme.linkSource).toBe("auto");
    expect(acme.invoicedExVat).toEqual([0, 0, 500, 0]);
    expect(ikea.clientKey).toBe("contact:ikea-xero");
    expect(ikea.linkSource).toBe("manual");
    expect(ikea.invoicedExVat).toEqual([0, 0, 0, 0]);
  });

  it("shows the latest-started running entry, and counts today's and this week's hours", () => {
    expect(result.running).toEqual({
      togglId: "E004-UUID",
      description: "Facilitation",
      projectName: "IKEA Way",
      clientName: "IKEA",
      startedAt: "2026-09-09T13:00:00.000Z",
      billable: false,
    });
    expect(result.todayHours).toBe(4); // 1.5h Acme + 1h IKEA running + 1.5h Agents running
    expect(result.weekHours).toBe(5); // + Tuesday's 1h; the 1 Sep / 2 Sep entries are last week
  });

  it("breaks each client down by project, with a 'No project' line for client-only entries", () => {
    expect(acme.projects.map((p) => [p.name, p.hours])).toEqual([
      ["Acme retainer", [0, 2.5, 2.5, 0]],
      ["No project", [0, 0, 2, 0]],
    ]);
    expect(acme.projects[0]).toMatchObject({ togglProjectId: 10, billable: false, rate: null, currency: null, color: null, active: true });
  });

  it("returns no rows and zero totals with no data", () => {
    const empty = rollupTime({ clients: [], projects: [], entries: [], links: new Map(), months, now, timeZone: TZ, linkOptions: [] });
    expect(empty.clients).toEqual([]);
    expect(empty.totals.hours).toEqual([0, 0, 0, 0]);
    expect(empty.running).toBeNull();
  });
});

describe("listEntries", () => {
  const data = {
    clients,
    projects,
    entries: [
      entry({ id: "AAA", projectId: 11, start: "2026-09-07T09:00:00Z", end: "2026-09-07T10:30:00Z", description: "Prep" }),
      entry({ id: "BBB", clientId: 68438745, start: "2026-09-09T13:00:00Z", description: "" }),
      // 23:30Z on 9 Sep is 00:30 BST on 10 Sep: outside a range ending the 9th
      entry({ id: "CCC", projectId: 10, start: "2026-09-09T23:30:00Z", end: "2026-09-10T00:30:00Z" }),
      entry({ id: "DDD", projectId: 10, start: "2026-09-06T08:00:00Z", end: "2026-09-06T09:00:00Z" }),
    ],
  };
  const result = listEntries({
    data,
    links,
    linkOptions: [{ clientKey: "contact:acme-xero", clientName: "Acme Ltd" }],
    from: "2026-09-07",
    to: "2026-09-09",
    now,
    timeZone: TZ,
  });

  it("filters by local start day and lists newest first", () => {
    expect(result.entries.map((e) => e.togglId)).toEqual(["BBB", "AAA"]);
  });

  it("keeps the TimeEntry shape, timing a running entry live", () => {
    expect(result.entries[0]).toEqual({
      togglId: "BBB",
      description: null,
      projectName: null,
      clientName: "Acme Ltd",
      clientKey: "contact:acme-xero",
      start: "2026-09-09T13:00:00.000Z",
      stop: null,
      durationSeconds: 3600,
      hours: 1,
      billable: false,
      tags: [],
      running: true,
    });
    expect(result.entries[1]).toMatchObject({ projectName: "IKEA Way", clientName: "IKEA", clientKey: "contact:ikea-xero", hours: 1.5, running: false });
    expect(result.totalHours).toBe(2.5);
    expect(result.billableHours).toBe(0);
  });
});
