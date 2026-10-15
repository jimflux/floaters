import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExampleRetirementPlan } from '@/lib/retirement';
import { SignInRequiredError } from '@/lib/session';
import type { RetirementSavedPlan } from '@floaters/types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), source: vi.fn(), workbook: vi.fn(), json: vi.fn() }));
vi.mock('@/lib/api', () => ({ getRetirementPlan: mocks.get, saveRetirementPlan: mocks.save, getRetirementPensionCashflow: mocks.source }));
vi.mock('@/lib/retirement-import', () => ({ importRetirementWorkbook: mocks.workbook, importRetirementJson: mocks.json, MAX_RETIREMENT_FILE_BYTES: 5 * 1024 * 1024 }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => <><div data-testid="projection-chart">{JSON.stringify(data)}</div>{children}</>,
  YAxis: ({ domain, allowDataOverflow }: { domain: unknown[]; allowDataOverflow: boolean }) => <div data-testid="chart-axis" data-domain={JSON.stringify(domain)} data-clips={String(allowDataOverflow)} />,
  ReferenceLine: ({ x }: { x: number }) => <span data-testid="milestone-reference" data-age={x} />,
  Line: () => null, XAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
}));
import RetirementPage from './RetirementPage';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.source.mockResolvedValue(pensionSource());
  mocks.get.mockResolvedValue({ plan: null, savedAt: null });
  mocks.save.mockImplementation(async plan => ({ plan, savedAt: '2026-10-14T12:00:00Z' }));
});
async function ready() { render(<RetirementPage />); await screen.findByText(/Example plan.*invented/i); }
afterEach(() => vi.useRealTimers());
function edit(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }

function pensionSource(amount = 100) {
  const year = new Date().getFullYear();
  const months = Array.from({ length: 36 }, (_, i) => `${year + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);
  return { months, cashOut: [{ accountCode: '700', accountName: 'Company pension', monthly: months.map(() => amount), isProjected: months.map((_, i) => i > 8), hasOverride: months.map(() => false) }] };
}
function addPensionLink() {
  fireEvent.click(screen.getByRole('button', { name: 'Add pension link' }));
  edit('Pension link 1 account', '700');
}
describe('linked pensions', () => {
  it('uses a linked zero instead of the preserved manual contribution', async () => {
    const plan = createExampleRetirementPlan(new Date().getFullYear());
    plan.partnerEnabled = false;
    plan.people[0].age = 50;
    plan.people[0].retirementAge = 60;
    plan.endAge = 50;
    plan.income = []; plan.spending = []; plan.oneOffs = [];
    for (const asset of Object.values(plan.people[0].assets)) {
      asset.balance = 0; asset.annualContribution = 0;
      asset.returns = { cautious: 0, base: 0, optimistic: 0 };
    }
    plan.people[0].assets.pension.balance = 10000;
    plan.people[0].assets.pension.annualContribution = 7200;
    mocks.get.mockResolvedValue({ plan, savedAt: null });
    mocks.source.mockResolvedValue(pensionSource(0));
    render(<RetirementPage />);
    await screen.findByLabelText('You name');
    expect(JSON.parse(screen.getByTestId('projection-chart').textContent!)[0]).toEqual({ age: 50, cautious: 17200, base: 17200, optimistic: 17200 });
    addPensionLink();
    expect(JSON.parse(screen.getByTestId('projection-chart').textContent!)[0]).toEqual({ age: 50, cautious: 10000, base: 10000, optimistic: 10000 });
    expect(screen.getByLabelText('You pension annual contribution')).toHaveValue(7200);
  });
  it('keeps manual projections working after a source error and requires complete linked calendar years', async () => {
    mocks.source.mockRejectedValueOnce(new Error('Unavailable'));
    await ready();
    expect(screen.getByTestId('projection-chart')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh pension source' }));
    await screen.findByText(/Last loaded:/);
    addPensionLink();
    expect(screen.getByText(/£1,200.*estimated/i)).toBeInTheDocument();
    const earlier = String(new Date().getFullYear() - 1);
    edit('Balances as of', `${earlier}-01-01`);
    expect(screen.getByLabelText('You pension annual contribution')).toBeEnabled();
    edit('Pension link 1 starting year', earlier);
    expect(screen.queryByTestId('projection-chart')).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert').some(alert => /Pension month.*missing/.test(alert.textContent ?? ''))).toBe(true);
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled();
    edit('Pension link 1 starting year', String(new Date().getFullYear()));
    expect(screen.getByTestId('projection-chart')).toBeInTheDocument();
  });
  it('blocks saving overallocated and blank shares without converting blank to zero', async () => {
    await ready();
    addPensionLink();
    fireEvent.click(screen.getByRole('button', { name: 'Add pension link' }));
    edit('Pension link 2 account', '700');
    edit('Pension link 2 person', '1');
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    edit('Pension link 1 share', '60');
    edit('Pension link 2 share', '40');
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled();
    edit('Pension link 2 share', '');
    expect(screen.getByLabelText('Pension link 2 share')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
  });
  it('requires explicit selection, replaces manual pension using the real engine, and disconnect restores it', async () => {
    await ready();
    const before = screen.getByTestId('projection-chart').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Add pension link' }));
    expect(screen.getByLabelText('Pension link 1 account')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    edit('Pension link 1 account', '700');
    expect(screen.getByText(/£1,200.*estimated/i)).toBeInTheDocument();
    expect(screen.getByTestId('projection-chart').textContent).not.toBe(before);
    expect(screen.getByLabelText('You pension annual contribution')).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][0].pensionLinks).toEqual([{ accountCode: '700', person: 0, share: 1, startYear: new Date().getFullYear() }]);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect pension link 1' }));
    expect(screen.getByTestId('projection-chart').textContent).toBe(before);
    expect(screen.getByLabelText('You pension annual contribution')).toBeEnabled();
  });
  it('retains the draft and export but blocks linked results on source failure and 401', async () => {
    await ready();
    addPensionLink();
    edit('You name', 'Keep my draft');
    mocks.source.mockRejectedValueOnce(new SignInRequiredError());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh pension source' }));
    await screen.findByRole('link', { name: 'Sign in in a new tab' });
    expect(screen.queryByTestId('projection-chart')).not.toBeInTheDocument();
    expect(screen.getByLabelText('You name')).toHaveValue('Keep my draft');
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect pension link 1' }));
    expect(screen.getByTestId('projection-chart')).toBeInTheDocument();
  });
  it('reloads on return, changes live amounts without editing the draft, and ignores older refreshes', async () => {
    const view = render(<RetirementPage />);
    await screen.findByText(/Example plan.*invented/i);
    addPensionLink();
    edit('You name', 'Preserved draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await screen.findByText('Plan saved.');
    let resolveOld!: (value: ReturnType<typeof pensionSource>) => void;
    mocks.source.mockReturnValueOnce(new Promise(done => { resolveOld = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh pension source' }));
    expect(screen.getByText(/Previous loaded amounts remain visible while updating/)).toBeInTheDocument();
    mocks.source.mockResolvedValueOnce(pensionSource(200));
    view.rerender(<RetirementPage active={false} />);
    view.rerender(<RetirementPage active />);
    await screen.findByText(/£2,400.*estimated/i);
    await act(async () => { resolveOld(pensionSource(900)); });
    expect(screen.getByText(/£2,400.*estimated/i)).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByLabelText('You name')).toHaveValue('Preserved draft');
    expect(mocks.get).toHaveBeenCalledOnce();
  });
});
describe('RetirementPage', () => {
  it('puts grouped events on the chart and opens their details without dirtying the saved plan', async () => {
    const year = new Date().getFullYear();
    const plan = createExampleRetirementPlan(year);
    plan.people[0].age = 40; plan.people[1].age = 35;
    plan.oneOffs = [{ id: 'gift', label: 'Windfall', person: 0, asset: 'isa', year: year + 5, amount: 20000 }];
    plan.income = [{ id: 'job', label: 'Part-time role', person: 1, kind: 'employment', startAge: 40, endAge: 50, annualAmount: 10000, taxable: true }];
    mocks.get.mockResolvedValue({ plan, savedAt: null });
    render(<RetirementPage />);
    await screen.findByLabelText('You name');
    const chart = screen.getByRole('group', { name: /projected household assets/ });
    expect(within(chart).getAllByTestId('milestone-reference').some(marker => marker.dataset.age === '45')).toBe(true);
    const milestones = screen.getByRole('region', { name: 'Chart milestones' });
    fireEvent.click(within(milestones).getByRole('button', { name: `Milestones in ${year + 5}` }));
    expect(within(milestones).getByText(/planned £20,000 into ISA/)).toBeInTheDocument();
    expect(within(milestones).getByText(/Part-time role · £10,000\/year/)).toBeInTheDocument();
    expect(within(milestones).getByText('Windfall', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    edit('One-off 1 year', String(year + 6));
    expect(within(milestones).getByRole('button', { name: `Milestones in ${year + 6}` })).toBeInTheDocument();
    fireEvent.click(within(milestones).getByRole('button', { name: `Milestones in ${year + 6}` }));
    expect(within(milestones).getByText(/your age 46/)).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('keeps saving available for edits throughout the plan and reloads the saved values', async () => {
    let stored = createExampleRetirementPlan(new Date().getFullYear());
    stored.oneOffs = [];
    stored.childSavings = { name: 'Example child', balanceDate: '2026-10-15', jisa: 100, universityFund: 200 };
    mocks.get.mockImplementation(async () => ({ plan: structuredClone(stored), savedAt: '2026-10-14T12:00:00Z' }));
    mocks.save.mockImplementation(async plan => {
      stored = structuredClone(plan);
      return { plan: structuredClone(stored), savedAt: '2026-10-15T12:00:00Z' };
    });
    const view = render(<RetirementPage />);
    await screen.findByLabelText('You name');
    const bar = screen.getByRole('region', { name: 'Plan saving' });
    expect(bar).toHaveClass('fixed', 'bottom-0');
    expect(within(bar).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    edit('You isa balance', '23456');
    edit('Child JISA balance', '3456');
    edit('Spending 1 annual amount', '28000');
    edit('You pension annual fees', '0.7');
    fireEvent.click(screen.getByRole('button', { name: 'Add one-off' }));
    edit('One-off 1 label', 'Planned purchase');
    edit('One-off 1 amount', '-5000');
    edit('One-off 1 year', String(new Date().getFullYear() + 2));
    expect(within(bar).getByText('Changes waiting to be saved')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Save changes' })).toBeEnabled();
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));
    await within(bar).findByText('All changes saved to database');
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    view.unmount();
    render(<RetirementPage />);
    expect(await screen.findByLabelText('You isa balance')).toHaveValue(23456);
    expect(screen.getByLabelText('Child JISA balance')).toHaveValue(3456);
    expect(screen.getByLabelText('Spending 1 annual amount')).toHaveValue(28000);
    expect(screen.getByLabelText('You pension annual fees')).toHaveValue(0.7);
    expect(screen.getByLabelText('One-off 1 label')).toHaveValue('Planned purchase');
    expect(screen.getByLabelText('One-off 1 amount')).toHaveValue(-5000);
    expect(screen.getByLabelText('One-off 1 year')).toHaveValue(new Date().getFullYear() + 2);
  });

  it('keeps failed changes available for retry from the persistent save bar', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Read-back unavailable'));
    await ready();
    edit('You isa balance', '23456');
    const bar = screen.getByRole('region', { name: 'Plan saving' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));
    await within(bar).findByText('Save failed. Your changes are still here.');
    expect(screen.getByLabelText('You isa balance')).toHaveValue(23456);
    expect(within(bar).queryByText('All changes saved to database')).not.toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Retry save' }));
    await within(bar).findByText('All changes saved to database');
  });

  it('explains invalid one-offs in the persistent bar and restores saving when corrected', async () => {
    const plan = createExampleRetirementPlan(new Date().getFullYear());
    plan.oneOffs = [];
    mocks.get.mockResolvedValue({ plan, savedAt: null });
    render(<RetirementPage />);
    await screen.findByLabelText('You name');
    fireEvent.click(screen.getByRole('button', { name: 'Add one-off' }));
    edit('One-off 1 amount', '');
    const bar = screen.getByRole('region', { name: 'Plan saving' });
    expect(within(bar).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(bar).toHaveTextContent(/one-off.*amount/i);
    edit('One-off 1 amount', '-5000');
    expect(within(bar).getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('focuses the scale on base while preserving full optimistic values and saved inputs', async () => {
    const plan = createExampleRetirementPlan(new Date().getFullYear());
    plan.partnerEnabled = false;
    plan.people[0].age = 40;
    plan.people[0].retirementAge = 80;
    plan.endAge = 60;
    delete plan.longevityAge;
    plan.income = []; plan.spending = []; plan.oneOffs = [];
    for (const asset of Object.values(plan.people[0].assets)) {
      asset.balance = 0; asset.annualContribution = 0;
      asset.returns = { cautious: 0, base: 0, optimistic: 0.2 };
      delete asset.grossReturns;
    }
    plan.people[0].assets.isa.balance = 10000;
    mocks.get.mockResolvedValue({ plan, savedAt: null });
    render(<RetirementPage />);
    await screen.findByLabelText('You name');
    const values = screen.getByTestId('projection-chart').textContent;
    expect(JSON.parse(values!).at(-1).optimistic).toBeGreaterThan(400000);
    expect(screen.getByText(/Scale capped at £15,000/)).toBeInTheDocument();
    expect(screen.getByTestId('chart-axis')).toHaveAttribute('data-domain', '[0,15000]');
    expect(screen.getByTestId('chart-axis')).toHaveAttribute('data-clips', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Show full range' }));
    expect(screen.getByTestId('chart-axis')).toHaveAttribute('data-domain', '[0,"auto"]');
    expect(screen.getByTestId('chart-axis')).toHaveAttribute('data-clips', 'false');
    expect(screen.getByTestId('projection-chart').textContent).toBe(values);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Focus on base' }));
    expect(screen.getByTestId('chart-axis')).toHaveAttribute('data-domain', '[0,15000]');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][0]).toEqual(plan);
  });

  it('shows an uncapped chart when all cases are zero', async () => {
    const plan = createExampleRetirementPlan(new Date().getFullYear());
    plan.income = []; plan.spending = []; plan.oneOffs = [];
    for (const person of plan.people) for (const asset of Object.values(person.assets)) {
      asset.balance = 0; asset.annualContribution = 0;
    }
    mocks.get.mockResolvedValue({ plan, savedAt: null });
    render(<RetirementPage />);
    await screen.findByLabelText('You name');
    expect(screen.queryByRole('button', { name: 'Show full range' })).not.toBeInTheDocument();
    expect(screen.getByTestId('chart-axis')).toHaveAttribute('data-clips', 'false');
  });

  it('lets stress tests change the outlook without editing or saving plan inputs', async () => {
    mocks.get.mockResolvedValue({ plan: createExampleRetirementPlan(), savedAt: null });
    render(<RetirementPage />);
    await screen.findByLabelText('You name');
    const before = screen.getByTestId('projection-chart').textContent;
    fireEvent.change(screen.getByLabelText('Stress test'), { target: { value: 'market-drop' } });
    expect(screen.getByText(/invested assets fall 30%/)).toBeInTheDocument();
    expect(screen.getByTestId('projection-chart').textContent).not.toBe(before);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Stress test'), { target: { value: 'none' } });
    expect(screen.getByTestId('projection-chart').textContent).toBe(before);
  });

  it('keeps fees hidden, allows confirmation and flags unverified State Pension estimates', async () => {
    const plan = createExampleRetirementPlan();
    plan.income[0].kind = 'state-pension'; plan.income[0].confirmed = false;
    mocks.get.mockResolvedValue({ plan, savedAt: null });
    render(<RetirementPage />);
    expect(await screen.findByLabelText('You pension annual fees')).not.toBeVisible();
    expect(screen.getByText(/State Pension amounts are estimates/)).not.toBeVisible();
    fireEvent.click(screen.getByText('Advanced assumptions'));
    edit('You pension annual fees', '0.8');
    fireEvent.click(screen.getByLabelText('You pension fees confirmed'));
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await screen.findByText('Plan saved.');
    expect(mocks.save.mock.calls[0][0].people[0].assets.pension).toMatchObject({ annualFee: 0.008, feesConfirmed: true });
    expect(mocks.save.mock.calls[0][0].people[0].assets.pension.grossReturns).toBeDefined();
  });

  it('shows the combined tiered fee and explicitly replaces it when a flat fee is entered', async () => {
    const plan = createExampleRetirementPlan();
    const pension = plan.people[0].assets.pension;
    pension.grossReturns = { cautious: 0.02, base: 0.05, optimistic: 0.07 };
    pension.feeSchedule = { threshold: 100000, below: 0.006, above: 0.002, fundCost: 0.001, marketSpread: 0.0005 };
    pension.feesConfirmed = true;
    mocks.get.mockResolvedValue({ plan, savedAt: null });
    render(<RetirementPage />);
    expect(await screen.findByLabelText('You pension annual fees')).toHaveValue(0.616667);
    fireEvent.click(screen.getByText('Advanced assumptions'));
    expect(screen.getByText(/Tiered management fee:/)).toBeVisible();
    edit('You pension base return', '4');
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled();
    edit('You pension annual fees', '0.9');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await screen.findByText('Plan saved.');
    const saved = mocks.save.mock.calls[0][0].people[0].assets.pension;
    expect(saved.annualFee).toBeCloseTo(0.009, 12);
    expect(saved.feeSchedule).toBeUndefined();
    expect(saved.feesConfirmed).toBe(false);
  });

  it('adds and saves a separately dated child savings section without changing the retirement chart', async () => {
    await ready();
    const before = screen.getByTestId('projection-chart').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Add child savings' }));
    edit('Child’s name', 'Example child');
    edit('Child balances as of', '2026-10-15');
    edit('Child JISA balance', '1200');
    edit('Child uni fund balance', '500');
    expect(screen.getByRole('heading', { name: 'Example child’s savings' })).toBeInTheDocument();
    expect(screen.getByText('£1,700')).toBeInTheDocument();
    expect(screen.getByTestId('projection-chart').textContent).toBe(before);
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save child savings' }));
    await screen.findByText('Plan saved.');
    expect(mocks.save.mock.calls[0][0].childSavings).toEqual({ name: 'Example child', balanceDate: '2026-10-15', jisa: 1200, universityFund: 500 });
  });

  it('loads child savings from the saved plan and blocks blank or negative amounts', async () => {
    const plan = createExampleRetirementPlan();
    plan.childSavings = { name: 'Example child', balanceDate: '2026-10-15', jisa: 1200, universityFund: 500 };
    mocks.get.mockResolvedValue({ plan, savedAt: null });
    render(<RetirementPage />);
    expect(await screen.findByLabelText('Child JISA balance')).toHaveValue(1200);
    edit('Child JISA balance', '');
    expect(screen.getByRole('button', { name: 'Save child savings' })).toBeDisabled();
    edit('Child JISA balance', '-1');
    expect(screen.getByRole('alert')).toHaveTextContent(/JISA balance/);
    edit('Child JISA balance', '0');
    expect(screen.getByRole('button', { name: 'Save child savings' })).toBeEnabled();
  });

  it('puts the chart first and keeps return assumptions and annual calculations closed', async () => {
    await ready();
    const chart = screen.getByRole('heading', { name: 'Projected assets by age' });
    const balances = screen.getByRole('heading', { name: 'Pension & ISA balances' });
    expect(chart.compareDocumentPosition(balances) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('You pension base return')).not.toBeVisible();
    expect(screen.getByLabelText('You pension contribution growth')).not.toBeVisible();
    expect(screen.getByText(/^Year-end balances\./)).not.toBeVisible();
    fireEvent.click(screen.getByText('Advanced assumptions'));
    expect(screen.getByLabelText('You pension base return')).toBeVisible();
  });

  it('shows age today and saves dated JPM balances without changing the retained return assumptions', async () => {
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const plan = createExampleRetirementPlan(2024);
    plan.people[0].age = 39;
    plan.people[1].age = 37;
    mocks.get.mockResolvedValue({ plan, savedAt: '2026-10-14T12:00:00Z' });
    render(<RetirementPage />);
    expect(await screen.findByLabelText('You current age')).toHaveValue(41);
    expect(screen.getByLabelText('Balances as of')).toHaveValue('2024-01-01');
    edit('You current age', '42');
    expect(screen.getByLabelText('You current age')).toHaveValue(42);
    edit('You current age', '41');
    fireEvent.click(screen.getByRole('button', { name: 'Use today' }));
    expect(screen.getByLabelText('Balances as of')).toHaveValue('2026-10-15');
    expect(screen.getByLabelText('You current age')).toHaveValue(41);
    expect(screen.getByLabelText('Partner current age')).toHaveValue(39);
    edit('You pension balance', '250000');
    edit('You isa balance', '40000');
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save balances' }));
    await screen.findByText('Plan saved.');
    const saved = mocks.save.mock.calls[0][0];
    expect(saved).toMatchObject({ startYear: 2026, balanceDate: '2026-10-15' });
    expect(saved.people[0].age).toBe(41);
    expect(saved.people[1].age).toBe(39);
    expect(saved.people[0].assets.pension.balance).toBe(250000);
    expect(saved.people[0].assets.isa.balance).toBe(40000);
    expect(saved.people[0].assets.pension.returns).toEqual(plan.people[0].assets.pension.returns);
    expect(saved.people[0].assets.cash).toEqual(plan.people[0].assets.cash);
    expect(JSON.parse(screen.getByTestId('projection-chart').textContent!)[0].age).toBe(41);
  });

  it('preserves unsaved balances across a calendar-year change without refetching the plan', async () => {
    vi.setSystemTime(new Date('2026-12-31T12:00:00Z'));
    const plan = createExampleRetirementPlan(2026);
    mocks.get.mockResolvedValue({ plan, savedAt: '2026-12-30T12:00:00Z' });
    const view = render(<RetirementPage />);
    await screen.findByLabelText('You pension balance');
    edit('You pension balance', '250000');
    vi.setSystemTime(new Date('2027-01-01T12:00:00Z'));
    await act(async () => { view.rerender(<RetirementPage />); });
    expect(screen.getByLabelText('You pension balance')).toHaveValue(250000);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('requires a balance date and blocks saving an undated update', async () => {
    await ready();
    edit('Balances as of', '');
    expect(screen.getByRole('alert')).toHaveTextContent(/balance date/i);
    expect(screen.getByRole('button', { name: 'Save balances' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
  });

  it('loads first, then presents a clearly unsaved example without autosaving', async () => {
    let resolve!: (value: RetirementSavedPlan) => void;
    mocks.get.mockReturnValue(new Promise<RetirementSavedPlan>(done => { resolve = done; }));
    render(<RetirementPage />);
    expect(screen.getByText(/Loading your retirement plan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    await act(async () => { resolve({ plan: null, savedAt: null }); });
    expect(screen.getByText(/Example plan.*invented/)).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('opens the saved plan and preserves it after editing until explicit save', async () => {
    const plan = createExampleRetirementPlan(2025);
    plan.people[0].name = 'Saved example';
    mocks.get.mockResolvedValue({ plan, savedAt: '2026-10-14T12:00:00Z' });
    render(<RetirementPage />);
    expect(await screen.findByDisplayValue('Saved example')).toBeInTheDocument();
    expect(screen.getByLabelText('Balances as of')).toHaveValue('2025-01-01');
    expect(screen.getByText('Saved')).toBeInTheDocument();
    edit('You name', 'Edited example');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(plan.people[0].name).toBe('Saved example');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('recalculates all three cases after an edit and changes annual details by case/year', async () => {
    await ready();
    const before = screen.getByTestId('projection-chart').textContent;
    edit('You cash balance', '50000');
    expect(screen.getByTestId('projection-chart').textContent).not.toBe(before);
    fireEvent.change(screen.getByLabelText('Detail case'), { target: { value: 'cautious' } });
    fireEvent.change(screen.getByLabelText('Selected year'), { target: { value: '2027' } });
    expect(screen.getByText(/Accessible assets in 2027/)).toBeInTheDocument();
  });
  it('keeps blank numbers invalid and blocks save/export/projections', async () => {
    await ready();
    edit('You current age', '');
    expect(screen.getByRole('alert')).toHaveTextContent(/age must be/);
    expect(screen.getByLabelText('You current age')).toHaveValue(null);
    expect(screen.queryByTestId('projection-chart')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
  });
  it('saves only on explicit action and marks the submitted plan saved', async () => {
    await ready();
    edit('You name', 'New example');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await screen.findByText('Plan saved.');
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][0].people[0].name).toBe('New example');
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });
  it('preserves the draft after save failure and supports explicit retry', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Save unavailable'));
    await ready();
    edit('You cash balance', '43210');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await screen.findByText(/Could not save/);
    expect(screen.getByLabelText('You cash balance')).toHaveValue(43210);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await screen.findByText('Plan saved.');
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });
  it('preserves the draft on session expiry and supports signing in in another tab', async () => {
    mocks.save.mockRejectedValueOnce(new SignInRequiredError());
    await ready();
    edit('You name', 'Keep this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    const link = await screen.findByRole('link', { name: 'Sign in in a new tab' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByLabelText('You name')).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await screen.findByText('Plan saved.');
  });
  it('locks editable controls while an asynchronous import replaces the plan', async () => {
    let resolve!: (value: ArrayBuffer) => void;
    const read = vi.fn(() => new Promise<ArrayBuffer>(done => { resolve = done; }));
    const file = new File(['synthetic workbook'], 'example.xlsx');
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    const imported = createExampleRetirementPlan();
    imported.people[0].name = 'Imported example';
    mocks.workbook.mockReturnValue({ plan: imported, warnings: [] });
    await ready();
    fireEvent.change(screen.getByLabelText('Workbook file'), { target: { files: [file] } });
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('You name')).toBeDisabled();
    expect(screen.getByLabelText('You cash balance')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add income' })).toBeDisabled();
    await act(async () => { resolve(new ArrayBuffer(4)); });
    expect(await screen.findByDisplayValue('Imported example')).toBeEnabled();
  });
  it('retains edits made during a pending save as unsaved', async () => {
    let resolve!: (value: RetirementSavedPlan) => void;
    mocks.save.mockReturnValue(new Promise<RetirementSavedPlan>(done => { resolve = done; }));
    await ready();
    edit('You name', 'Submitted example');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    edit('You name', 'Later edit');
    await act(async () => { resolve({ plan: mocks.save.mock.calls[0][0], savedAt: '2026-10-14T12:00:00Z' }); });
    expect(screen.getByLabelText('You name')).toHaveValue('Later edit');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText(/Saved snapshot.*unsaved changes/)).toBeInTheDocument();
    const bar = screen.getByRole('region', { name: 'Plan saving' });
    expect(within(bar).getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(bar).toHaveTextContent('Changes waiting to be saved');
  });
  it('requires successful load retry before editing or importing can replace a remote plan', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Unavailable'));
    render(<RetirementPage />);
    await screen.findByText(/Could not load/);
    expect(screen.getByRole('button', { name: 'Import workbook' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    expect(screen.queryByLabelText('You name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await screen.findByText(/Example plan.*invented/);
  });
  it('provides sign-in recovery when the authenticated session has ended', async () => {
    mocks.get.mockRejectedValueOnce(new SignInRequiredError());
    render(<RetirementPage />);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', expect.stringContaining('https://login.flux.am/'));
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
  });
  it('imports workbook settings locally, preserving old year and showing review warnings', async () => {
    const imported = createExampleRetirementPlan(2024);
    imported.people[0].name = 'Imported example';
    mocks.workbook.mockReturnValue({ plan: imported, warnings: ['This workbook starts in 2024. Review the baseline.'] });
    await ready();
    const file = new File(['synthetic workbook'], 'example.xlsx');
    Object.defineProperty(file, 'arrayBuffer', { value: vi.fn().mockResolvedValue(new ArrayBuffer(4)) });
    fireEvent.change(screen.getByLabelText('Workbook file'), { target: { files: [file] } });
    await screen.findByDisplayValue('Imported example');
    expect(screen.getByLabelText('Balances as of')).toHaveValue('2024-01-01');
    expect(screen.getByText(/This workbook starts in 2024/)).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Workbook file')).toHaveValue('');
  });
  it('rejects oversized files before reading them and preserves the draft after invalid imports', async () => {
    await ready();
    const file = new File(['x'], 'huge.xlsx');
    const read = vi.fn();
    Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 });
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    fireEvent.change(screen.getByLabelText('Workbook file'), { target: { files: [file] } });
    await screen.findByText(/Workbook must be no larger than 5 MB/);
    expect(read).not.toHaveBeenCalled();
    mocks.json.mockImplementation(() => { throw new Error('Invalid JSON example'); });
    const invalid = new File(['bad'], 'bad.json');
    Object.defineProperty(invalid, 'text', { value: vi.fn().mockResolvedValue('bad') });
    fireEvent.change(screen.getByLabelText('JSON plan file'), { target: { files: [invalid] } });
    await screen.findByText(/Invalid JSON example/);
    expect(screen.getByLabelText('You name')).toHaveValue('Example person');
  });
  it('imports valid JSON locally and bounds its file size before reading', async () => {
    await ready();
    const oversized = new File(['x'], 'huge.json');
    const read = vi.fn();
    Object.defineProperty(oversized, 'size', { value: 100 * 1024 + 1 });
    Object.defineProperty(oversized, 'text', { value: read });
    fireEvent.change(screen.getByLabelText('JSON plan file'), { target: { files: [oversized] } });
    await screen.findByText(/JSON plan must be no larger than 100 KB/);
    expect(read).not.toHaveBeenCalled();
    const imported = createExampleRetirementPlan(2023);
    imported.people[0].name = 'JSON example';
    mocks.json.mockReturnValue({ plan: imported, warnings: [] });
    const file = new File(['synthetic JSON'], 'example.json');
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('synthetic JSON') });
    fireEvent.change(screen.getByLabelText('JSON plan file'), { target: { files: [file] } });
    await screen.findByDisplayValue('JSON example');
    expect(screen.getByLabelText('Balances as of')).toHaveValue('2023-01-01');
    expect(mocks.json).toHaveBeenCalledWith('synthetic JSON');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('JSON plan file')).toHaveValue('');
  });
  it('exports the current valid draft as JSON and revokes its object URL', async () => {
    await ready();
    edit('You name', 'Export example');
    addPensionLink();
    const create = vi.fn((_blob: Blob) => 'blob:retirement-example');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:retirement-example'));
    const blob = create.mock.calls[0][0] as Blob;
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(JSON.parse(text).people[0].name).toBe('Export example');
    expect(JSON.parse(text).pensionLinks).toEqual([{ accountCode: '700', person: 0, share: 1, startYear: new Date().getFullYear() }]);
    expect(blob.size).toBeLessThan(100 * 1024);
    expect(mocks.save).not.toHaveBeenCalled();
    click.mockRestore();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });
  it('toggles partner and supports adding/removing income, spending and one-offs', async () => {
    await ready();
    fireEvent.click(screen.getByLabelText('Include partner'));
    expect(screen.queryByLabelText('Partner name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add income' }));
    expect(screen.getByLabelText('Income 3 label')).toHaveValue('New income');
    fireEvent.click(screen.getByRole('button', { name: 'Remove income 3' }));
    expect(screen.queryByLabelText('Income 3 label')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add spending' }));
    expect(screen.getByLabelText('Spending 2 label')).toHaveValue('New spending');
    fireEvent.click(screen.getByRole('button', { name: 'Add one-off' }));
    expect(screen.getByLabelText('One-off 1 amount')).toHaveValue(0);
  });
});
