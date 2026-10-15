import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExampleRetirementPlan } from '@/lib/retirement';
import { SignInRequiredError } from '@/lib/session';
import type { RetirementSavedPlan } from '@floaters/types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), source: vi.fn(), workbook: vi.fn(), json: vi.fn() }));
vi.mock('@/lib/api', () => ({ getRetirementPlan: mocks.get, saveRetirementPlan: mocks.save, getRetirementPensionCashflow: mocks.source }));
vi.mock('@/lib/retirement-import', () => ({ importRetirementWorkbook: mocks.workbook, importRetirementJson: mocks.json, MAX_RETIREMENT_FILE_BYTES: 5 * 1024 * 1024 }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ data }: { data: unknown[] }) => <div data-testid="projection-chart">{JSON.stringify(data)}</div>,
  Line: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
}));
import RetirementPage from './RetirementPage';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.source.mockResolvedValue(pensionSource());
  mocks.get.mockResolvedValue({ plan: null, savedAt: null });
  mocks.save.mockImplementation(async plan => ({ plan, savedAt: '2026-10-14T12:00:00Z' }));
});
async function ready() { render(<RetirementPage />); await screen.findByText(/Example plan.*invented/i); }
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
    edit('Baseline year', earlier);
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
    expect(screen.getByLabelText('Baseline year')).toHaveValue(2025);
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
    expect(screen.getByLabelText('Baseline year')).toHaveValue(2024);
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
    expect(screen.getByLabelText('Baseline year')).toHaveValue(2023);
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
