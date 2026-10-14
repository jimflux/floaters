import { describe, expect, it } from 'vitest';
import { zeroChip, zeroDateLabel } from './brand';

describe('runway display', () => {
  it('does not mark 21 months as one month of urgency', () => {
    expect(zeroChip('21 months')).toBe('bg-mint text-aubergine');
    expect(zeroChip('2 months')).toBe('bg-coral text-aubergine');
    expect(zeroChip('4 months')).toBe('bg-sun text-aubergine');
  });
  it('shows a calendar month and avoids an unsupported Never claim', () => {
    expect(zeroDateLabel('2028-07', '21 months')).toBe('July 2028');
    expect(zeroDateLabel(null, null)).toBe('No depletion at current spending');
  });
});
