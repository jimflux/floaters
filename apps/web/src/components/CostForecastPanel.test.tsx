import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CostForecastReview } from '@floaters/types';
import CostForecastPanel from './CostForecastPanel';

const save = vi.fn();
const remove = vi.fn();
vi.mock('@/lib/api', () => ({ saveCostSetting: (...args: unknown[]) => save(...args), removeCostSetting: (...args: unknown[]) => remove(...args) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const review: CostForecastReview = {
  settings: { rules: [], oneOffIds: [] },
  suggestions: [{ accountCode: '400', streamKey: 'supplier:adobe', label: 'Adobe', amount: 30, frequencyMonths: 1, startMonth: '2026-10', endMonth: null, evidenceCount: 3, reason: 'Three monthly payments' }],
  recentPayments: [{ id: 'payment-1', accountCode: '400', streamKey: 'supplier:adobe', label: 'Adobe', amount: 30, date: '2026-09-01' }],
};
function mount(data = review) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['cashflow'], {});
  const view = (next: CostForecastReview) => <QueryClientProvider client={client}><CostForecastPanel open onOpenChange={vi.fn()} forecast={next} accounts={[{ code: '400', name: 'Software', type: 'OVERHEADS', section: 'costs', hidden: false }]} currentMonth="2026-10" /></QueryClientProvider>;
  return { ...render(view(data)), client, view };
}
beforeEach(() => { save.mockReset().mockResolvedValue(undefined); remove.mockReset().mockResolvedValue(undefined); });
describe('cost forecast review', () => {
  it('waits for confirmation and saves the edited schedule, recovering a blank amount', async () => {
    const { client } = mount();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review Adobe' }));
    fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Confirm recurring cost' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('End month (optional)'), { target: { value: '2027-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm recurring cost' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ type: 'recurring', rule: { accountCode: '400', streamKey: 'supplier:adobe', label: 'Adobe', amount: 42, frequencyMonths: 3, startMonth: '2026-10', endMonth: '2027-10' } }));
    await waitFor(() => expect(client.getQueryState(['cashflow'])?.isInvalidated).toBe(true));
  });
  it('marks and undoes a one-off without deleting the payment', async () => {
    const { rerender, view } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Adobe as one-off' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ type: 'one_off', transactionId: 'payment-1' }));
    rerender(view({ ...review, settings: { rules: [], oneOffIds: ['payment-1'] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo one-off for Adobe' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ type: 'one_off', transactionId: 'payment-1' }));
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();
  });
  it('retains a draft on save failure and allows retry', async () => {
    save.mockRejectedValueOnce(new Error('Offline'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Review Adobe' }));
    fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '81' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm recurring cost' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByLabelText('Amount (£)')).toHaveValue(81);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm recurring cost' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });
  it('creates an additional single expense with its own stream and one month duration', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Additional planned cost' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Laptop' } });
    fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '1200' } });
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'once' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save planned cost' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ type: 'recurring', rule: expect.objectContaining({ accountCode: '400', streamKey: expect.stringMatching(/^manual:/), label: 'Laptop', amount: 1200, frequencyMonths: 1, startMonth: '2026-10', endMonth: '2026-10' }) }));
  });
});

it('lets the user match a changing description to a reviewed schedule', async () => {
  mount({ ...review, streams: [{ streamKey: 'adobe-june', accountCode: '400', label: 'Adobe June subscription' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Review Adobe' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Adobe June subscription' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm recurring cost' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ type: 'recurring', rule: expect.objectContaining({ matchStreamKeys: ['adobe-june'] }) }));
});
it('does not offer accounts managed by the VAT forecast for additional schedules', () => {
  mount({ ...review, managedAccountCodes: ['400'] });
  expect(screen.getByRole('button', { name: 'Additional planned cost' })).toBeDisabled();
});
