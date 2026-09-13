// Pure helpers for the Hours (Toggl) surfaces, shared by the grid section,
// the mobile block and the panel.
import type { TimeTrackingResponse, TimeClient } from './types';

export function formatHours(h: number): string {
  const rounded = Math.round(h * 10) / 10;
  if (!rounded) return '';
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
}

function formatGBP(n: number): string {
  const abs = Math.abs(Math.round(n));
  return `${n < 0 ? '-' : ''}£${abs.toLocaleString('en-GB')}`;
}

// The time response carries its own months[]; index by key so the section
// never misaligns if the two windows ever differ.
export function monthIndexer(time: TimeTrackingResponse | undefined): (month: string) => number {
  const idx = new Map((time?.months ?? []).map((m, i) => [m, i]));
  return (month: string) => idx.get(month) ?? -1;
}

export function cellTitle(c: TimeClient, i: number): string {
  if (i < 0) return '';
  const parts: string[] = [];
  const hours = c.hours[i] ?? 0;
  const billable = c.billableHours[i] ?? 0;
  if (hours) parts.push(`${formatHours(hours)} worked`);
  if (billable) parts.push(`${formatHours(billable)} billable`);
  const invoiced = c.invoicedExVat?.[i] ?? 0;
  if (invoiced) parts.push(`${formatGBP(invoiced)} invoiced ex VAT`);
  if (invoiced && hours) parts.push(`${formatGBP(invoiced / hours)}/hr`);
  return parts.join(' · ');
}
