// Shared look-only helpers for the Flux palette. Nothing here touches a
// number; it only picks classes for how a figure or state is shown.

// Negative money: coral tint + coral edge behind aubergine text (coral text
// would fail contrast on white). The minus sign stays in the figure.
export function moneyTone(value: number): string {
  return value < 0 ? 'money-neg' : '';
}

// A grid cell's background: negative wins over the current-month column so the
// two never fight over the same property.
export function cellTone(value: number, isCurrentMonth: boolean): string {
  if (value < 0) return 'money-neg';
  return isCurrentMonth ? 'bg-col-highlight' : '';
}

// "Drops below £0" urgency as a chip: coral within two months, sun within
// five, mint otherwise. Brand fills always carry aubergine text, and the
// chip's words carry the meaning, never the colour alone.
export function zeroChip(value: string | null): string {
  if (!value) return 'bg-mint text-aubergine';
  const lower = value.toLowerCase();
  if (lower === 'this month' || lower.includes('1 month') || lower.includes('2 month')) return 'bg-coral text-aubergine';
  if (lower.includes('3 month') || lower.includes('4 month') || lower.includes('5 month')) return 'bg-sun text-aubergine';
  return 'bg-mint text-aubergine';
}

// Income layer keys: paid = mint (cash in), invoiced = iris (sent, awaiting
// payment), projected = sun (hoped for). Each dot sits next to its label.
export const LAYER_DOT = {
  paid: 'bg-mint',
  invoiced: 'bg-iris',
  projected: 'bg-sun',
} as const;
