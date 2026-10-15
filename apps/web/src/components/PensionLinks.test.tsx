import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { RetirementPlan } from '@floaters/types';
import { createExampleRetirementPlan } from '@/lib/retirement';
import { PensionLinks } from './PensionLinks';

const year = new Date().getFullYear();
const months = Array.from({ length: 36 }, (_, i) => `${year + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);
const account = (accountCode: string, accountName: string) => ({ accountCode, accountName, monthly: months.map(() => 100), isProjected: months.map(() => true), hasOverride: months.map(() => false) });
const source = { months, cashOut: [account('900', 'Office costs'), account('VAT_LIABILITY', 'VAT'), account('700', 'Pension payments')] };
function Harness({ initial }: { initial: RetirementPlan }) {
  const [plan, setPlan] = useState(initial);
  return <PensionLinks plan={plan} onChange={pensionLinks => setPlan({ ...plan, pensionLinks })} source={source} loading={false} error={null} loadedAt="2026-10-15T10:00:00Z" onRefresh={vi.fn()} />;
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
describe('PensionLinks', () => {
  it('offers actual cost accounts with pension names first, excludes VAT, and does not mutate the plan', () => {
    const initial = createExampleRetirementPlan(year);
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add pension link' }));
    const selector = screen.getByLabelText('Pension link 1 account');
    expect(selector).toHaveValue('');
    expect([...selector.querySelectorAll('option')].map(option => option.value)).toEqual(['', '700', '900']);
    change('Pension link 1 account', '900');
    change('Pension link 1 person', '1');
    expect(initial.pensionLinks).toBeUndefined();
    expect(screen.getByText(/Partner.*£1,200/)).toBeInTheDocument();
  });
  it('uses shared allocation validation for duplicate, zero, blank and overallocated shares', () => {
    const initial = createExampleRetirementPlan(year);
    initial.pensionLinks = [{ accountCode: '700', person: 0, share: 1, startYear: year }];
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add pension link' }));
    change('Pension link 2 account', '700');
    expect(screen.getByRole('alert')).toHaveTextContent(/duplicates/);
    expect(screen.getByRole('alert')).toHaveTextContent(/must not exceed 100%/);
    change('Pension link 2 person', '1');
    change('Pension link 1 share', '60');
    change('Pension link 2 share', '40');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    change('Pension link 2 share', '0');
    expect(screen.getByRole('alert')).toHaveTextContent(/greater than zero/);
    change('Pension link 2 share', '');
    expect(screen.getByRole('alert')).toHaveTextContent(/share must be/);
    expect(screen.getByLabelText('Pension link 2 share')).toHaveValue(null);
  });
  it('keeps unavailable accounts and disabled partner links visible for repair or disconnect', () => {
    const initial = createExampleRetirementPlan(year);
    initial.partnerEnabled = false;
    initial.pensionLinks = [{ accountCode: 'missing', person: 1, share: 1, startYear: year }];
    render(<Harness initial={initial} />);
    expect(screen.getByLabelText('Pension link 1 account')).toHaveValue('missing');
    expect(screen.getByRole('option', { name: 'missing (unavailable)' })).toBeInTheDocument();
    expect(screen.getByText(/retained and ignored/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Restore it in Floaters or disconnect/);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect pension link 1' }));
    expect(screen.queryByLabelText('Pension link 1 account')).not.toBeInTheDocument();
    expect(initial.people[1].assets.pension.annualContribution).toBeGreaterThan(0);
  });
});
