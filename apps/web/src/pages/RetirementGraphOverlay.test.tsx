import { cloneElement, type ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createExampleRetirementPlan } from '@/lib/retirement';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ getRetirementPlan: api.get, saveRetirementPlan: vi.fn(), getRetirementPensionCashflow: async () => ({ months: [], cashOut: [] }) }));
vi.mock('recharts', async importOriginal => ({
  ...await importOriginal<typeof import('recharts')>(),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 800, height: 400 }),
}));
import RetirementPage from './RetirementPage';

it('renders accessible/locked paths and a visible gap band through real Recharts, and removes them when toggled off', async () => {
  const plan = createExampleRetirementPlan(2036);
  plan.partnerEnabled = false; plan.inflation = 0; delete plan.longevityAge;
  plan.people[0].age = 51; plan.people[0].retirementAge = 51; plan.people[0].pensionAccessAge = 57;
  plan.endAge = 58; plan.income = [];
  for (const asset of Object.values(plan.people[0].assets)) {
    asset.balance = 0; asset.annualContribution = 0; asset.returns = { cautious: 0, base: 0, optimistic: 0 };
  }
  plan.people[0].assets.isa.balance = 50000; plan.people[0].assets.pension.balance = 500000;
  plan.spending = [{ id: 'living', label: 'Living', startAge: 51, endAge: 100, annualAmount: 10000 }];
  api.get.mockResolvedValue({ plan, savedAt: null });
  const { container } = render(<RetirementPage />);
  const toggle = await screen.findByRole('button', { name: 'Funding overlay' });
  await waitFor(() => expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(3));
  fireEvent.click(toggle);
  await waitFor(() => expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(5));
  const band = container.querySelector('.recharts-reference-area-rect');
  expect(band).not.toBeNull();
  expect(Number(band!.getAttribute('width'))).toBeGreaterThan(0);
  expect(container.querySelector('path.recharts-line-curve[stroke="hsl(158 36% 35%)"]')).not.toBeNull();
  expect(screen.getByText('Accessible · Base')).toBeInTheDocument();
  expect(screen.getByText('Locked pension · Base')).toBeInTheDocument();
  fireEvent.click(toggle);
  await waitFor(() => expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(3));
  expect(container.querySelector('.recharts-reference-area-rect')).toBeNull();
});
