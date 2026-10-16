import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { createExampleRetirementPlan, projectRetirement } from '@/lib/retirement';
import { RetirementFunding } from './RetirementFunding';

function fixture() {
  const plan = createExampleRetirementPlan(2036);
  plan.partnerEnabled = false; plan.inflation = 0; delete plan.longevityAge;
  plan.people[0].age = 51; plan.people[0].retirementAge = 51; plan.people[0].pensionAccessAge = 57;
  plan.endAge = 68;
  for (const asset of Object.values(plan.people[0].assets)) {
    asset.balance = 0; asset.annualContribution = 0; asset.returns = { cautious: 0, base: 0, optimistic: 0 };
  }
  plan.people[0].assets.isa.balance = 50000; plan.people[0].assets.pension.balance = 500000;
  plan.income = [{ id: 'state', label: 'State Pension', kind: 'state-pension', person: 0, startAge: 68, endAge: 120, annualAmount: 12000, taxable: true }];
  plan.spending = [{ id: 'living', label: 'Living', startAge: 51, endAge: 100, annualAmount: 10000 }];
  return plan;
}
function Harness({ stress = 'none' as const }: { stress?: 'none' | 'later-state-pension' }) {
  const plan = fixture(); plan.endAge = 70;
  const [year, setYear] = useState(2036);
  return <RetirementFunding plan={plan} projection={projectRetirement(plan, 'base', undefined, stress)} caseLabel="Base" stress={stress} selectedYear={year} onYear={setYear} />;
}
describe('retirement funding visibility', () => {
  it('exposes the bridge gap and locked money, then shows private pension and State Pension separately', () => {
    render(<Harness />);
    expect(screen.getByRole('alert')).toHaveTextContent('2041');
    expect(screen.getByRole('alert')).toHaveTextContent('£10,000');
    fireEvent.click(screen.getByRole('button', { name: 'Show first funding gap' }));
    expect(screen.getByLabelText('Funding year')).toHaveValue('2041');
    expect(within(screen.getByLabelText('Funding details')).getByText('£500,000')).toBeInTheDocument();
    expect(screen.getByText('£833/month')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2042.*pension access/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2053.*State Pension starts/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /2042.*pension access/ }));
    expect(screen.getByLabelText('Funding year')).toHaveValue('2042');
    expect(screen.getByLabelText('Pension withdrawals')).toHaveTextContent('£10,000');
    expect(screen.getByLabelText('Unfunded spending and tax')).toHaveTextContent('£0');
  });
  it('moves State Pension unlocking with its stress test without moving private pension access', () => {
    render(<Harness stress="later-state-pension" />);
    expect(screen.getByRole('button', { name: /2055.*State Pension starts/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2042.*pension access/ })).toBeInTheDocument();
  });
});

it('annualises a partial first year rather than dividing its remaining spending by twelve', () => {
  const plan = fixture(); plan.balanceDate = '2036-07-01'; plan.endAge = 51;
  plan.spending[0].annualAmount = 12000;
  render(<RetirementFunding plan={plan} projection={projectRetirement(plan, 'base')} caseLabel="Base" stress="none" selectedYear={2036} onYear={() => {}} />);
  expect(screen.getByText('£1,000/month')).toBeInTheDocument();
  expect(screen.getByText(/over the remaining year/)).toBeInTheDocument();
});
it('does not label a blocked one-off as a living-cost funding gap', () => {
  const plan = fixture(); plan.endAge = 51;
  plan.oneOffs = [{ id: 'locked', label: 'Planned withdrawal', person: 0, asset: 'pension', year: 2036, amount: -5000 }];
  render(<RetirementFunding plan={plan} projection={projectRetirement(plan, 'base')} caseLabel="Base" stress="none" selectedYear={2036} onYear={() => {}} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText(/A further £5,000 of planned one-offs/)).toBeInTheDocument();
});
