import { describe, expect, it } from 'vitest';
import { createExampleRetirementPlan } from './retirement';
import { milestoneLanes, retirementMilestones } from './retirement-milestones';

const visible = Array.from({ length: 71 }, (_, i) => 2026 + i);
function plan() {
  const value = createExampleRetirementPlan(2026);
  value.people[0].name = 'Alex'; value.people[0].age = 40; value.people[0].retirementAge = 60;
  value.people[1].name = 'Sam'; value.people[1].age = 35; value.people[1].retirementAge = 65;
  value.income = [];
  return value;
}

describe('retirement milestones', () => {
  it('aligns each adult’s events to calendar years and the primary age axis', () => {
    const value = plan();
    value.income = [
      { id: 'work', label: 'Part-time role', person: 1, kind: 'employment', startAge: 45, endAge: 60, annualAmount: 10000, taxable: true },
      { id: 'state', label: 'State Pension', person: 1, kind: 'state-pension', startAge: 68, endAge: 120, annualAmount: 12000, taxable: true },
    ];
    const groups = retirementMilestones(value, visible);
    expect(groups.find(g => g.year === 2036)).toMatchObject({ age: 50, events: [expect.objectContaining({ label: 'Sam: work starts', detail: expect.stringContaining('£10,000/year') })] });
    expect(groups.find(g => g.year === 2046)).toMatchObject({ age: 60, events: [expect.objectContaining({ label: 'Alex: retirement' })] });
    expect(groups.find(g => g.year === 2056)).toMatchObject({ age: 70, events: [expect.objectContaining({ label: 'Sam: retirement' })] });
    expect(groups.find(g => g.year === 2059)).toMatchObject({ age: 73, events: [expect.objectContaining({ label: 'Sam: State Pension starts' })] });
    expect(groups.flatMap(g => g.events).find(e => e.id === 'access-0')?.detail).toContain('only when needed');
  });

  it('groups multiple events in one year and distinguishes money in and out without changing inputs', () => {
    const value = plan();
    value.oneOffs = [
      { id: 'in', label: 'Windfall', person: 0, year: 2046, asset: 'isa', amount: 20000 },
      { id: 'out', label: 'Trip', person: 1, year: 2046, asset: 'cash', amount: -3000 },
    ];
    const before = structuredClone(value);
    const groups = retirementMilestones(value, visible);
    expect(groups.filter(g => g.year === 2046)).toHaveLength(1);
    const events = groups.find(g => g.year === 2046)!.events;
    expect(events).toHaveLength(3);
    expect(events.find(e => e.id === 'oneoff-in')?.detail).toContain('£20,000 into ISA');
    expect(events.find(e => e.id === 'oneoff-out')?.detail).toContain('£3,000 out of cash');
    expect(value).toEqual(before);
  });

  it('excludes disabled adults, zero amounts and events outside the visible chart years', () => {
    const value = plan();
    value.partnerEnabled = false;
    value.income = [{ id: 'partner', label: 'Partner income', person: 1, startAge: 55, endAge: 80, annualAmount: 10000, taxable: true }];
    value.oneOffs = [
      { id: 'zero', label: 'Empty', person: 0, year: 2046, asset: 'cash', amount: 0 },
      { id: 'partner', label: 'Partner gift', person: 1, year: 2046, asset: 'cash', amount: 1000 },
      { id: 'past', label: 'Past', person: 0, year: 2026, asset: 'cash', amount: 1000 },
      { id: 'future', label: 'Future', person: 0, year: 2080, asset: 'cash', amount: 1000 },
    ];
    expect(retirementMilestones(value, [2046])).toEqual([{ year: 2046, age: 60, events: [expect.objectContaining({ id: 'retire-0' })] }]);
  });

  it('moves only State Pension starts in the delayed-pension stress case', () => {
    const value = plan();
    value.income = [
      { id: 'state', label: 'State Pension', person: 0, kind: 'state-pension', startAge: 68, endAge: 120, annualAmount: 12000, taxable: true },
      { id: 'work', label: 'Work', person: 0, kind: 'employment', startAge: 68, endAge: 80, annualAmount: 6000, taxable: true },
    ];
    const groups = retirementMilestones(value, visible, 'later-state-pension');
    expect(groups.find(g => g.year === 2054)?.events.map(e => e.id)).toEqual(['income-work']);
    const statePension = groups.find(g => g.year === 2056)?.events.find(event => event.id === 'income-state');
    expect(statePension).toMatchObject({ detail: expect.stringContaining('age 70') });
    expect(statePension?.detail).toContain('entitlement unconfirmed');
  });

  it('matches survivor illustrations and suppresses events after the deceased adult’s death', () => {
    const value = plan();
    value.income = [{ id: 'late', label: 'Late income', person: 0, startAge: 90, endAge: 100, annualAmount: 5000, taxable: true }];
    value.oneOffs = [{ id: 'late', label: 'Late gift', person: 0, year: 2071, asset: 'isa', amount: 1000 }];
    const groups = retirementMilestones(value, visible, 'lose-you');
    expect(groups.find(g => g.year === 2071)?.events.map(e => e.id)).toEqual(['survivor']);
    expect(groups.flatMap(g => g.events).some(e => e.id === 'income-late')).toBe(false);
  });

  it('stagger dense markers within the measured chart width and reuses free lanes', () => {
    const groups = Array.from({ length: 20 }, (_, i) => ({ year: 2030 + i, age: 40 + i, events: [] }));
    const placed = milestoneLanes(groups, 40, 100, 300);
    expect(placed[1].lane).not.toBe(placed[0].lane);
    for (const group of placed) {
      const previous = placed.slice(0, placed.indexOf(group)).filter(g => g.lane === group.lane).pop();
      if (previous) expect((group.age - previous.age) / 60 * 210).toBeGreaterThanOrEqual(26);
    }
    expect(new Set(placed.map(g => g.lane)).size).toBeLessThan(groups.length);
    expect(milestoneLanes(groups, 40, 100, 1600).some(g => g.lane === 0 && g.year > 2030)).toBe(true);
  });
});
