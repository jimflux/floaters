import type { RetirementMilestoneGroup } from '@/lib/retirement-milestones';

interface Props {
  group: RetirementMilestoneGroup;
  number: number;
  active: boolean;
  lane: number;
  onSelect: () => void;
  viewBox?: { x?: number; y?: number };
}

/** A numbered marker stays visible even when the asset curves exceed the axis. */
export function RetirementMilestoneMarker({ group, number, active, lane, onSelect, viewBox }: Props) {
  if (viewBox?.x === undefined || viewBox.y === undefined) return null;
  const label = `${group.year} · age ${group.age} · ${group.events.map(event => event.label).join('; ')}`;
  return <g transform={`translate(${viewBox.x}, ${viewBox.y - 12 - lane * 24})`} role="button" tabIndex={0} aria-label={label} aria-pressed={active}
    className="cursor-pointer outline-none focus:stroke-[3px]" onMouseEnter={onSelect} onFocus={onSelect} onClick={onSelect}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}>
    <title>{label}</title>
    <line x1={0} y1={11} x2={0} y2={12 + lane * 24} stroke="hsl(var(--iris-deep))" strokeOpacity={0.3} strokeDasharray="2 4" />
    <circle r={11} fill={active ? 'hsl(var(--iris-deep))' : 'hsl(var(--card))'} stroke="hsl(var(--iris-deep))" strokeWidth={active ? 2 : 1} />
    <text textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill={active ? 'hsl(var(--card))' : 'hsl(var(--iris-deep))'} stroke="none">{number}</text>
  </g>;
}
