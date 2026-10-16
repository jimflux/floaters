import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { RetirementMilestoneMarker } from './RetirementMilestoneMarker';

describe('RetirementMilestoneMarker', () => {
  it('renders at the correct year through real Recharts labels and supports mouse and keyboard', () => {
    const select = vi.fn();
    const group = { year: 2046, age: 60, events: [{ id: 'retire', kind: 'retirement' as const, label: 'Alex: retirement', detail: 'Planned retirement.' }] };
    render(<LineChart width={600} height={300} margin={{ top: 40 }} data={[{ age: 50, value: 1000 }, { age: 60, value: 2000 }, { age: 70, value: 3000 }]}>
      <XAxis dataKey="age" /><YAxis domain={[0, 5000]} /><Line dataKey="value" isAnimationActive={false} />
      <ReferenceLine x={60} label={<RetirementMilestoneMarker group={group} number={1} lane={0} active={false} onSelect={select} />} />
    </LineChart>);
    const marker = screen.getByRole('button', { name: '2046 · age 60 · Alex: retirement' });
    expect(marker.getAttribute('transform')).toMatch(/^translate\([\d.]+, 28\)$/);
    expect(marker).toHaveAttribute('tabindex', '0');
    fireEvent.mouseEnter(marker);
    fireEvent.keyDown(marker, { key: 'Enter' });
    fireEvent.keyDown(marker, { key: ' ' });
    expect(select).toHaveBeenCalledTimes(3);
  });
});
