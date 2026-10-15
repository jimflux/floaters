import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('./pages/CashflowPage', () => ({ default: function Cashflow() {
  const [value, setValue] = useState('Cashflow draft');
  return <input aria-label="Cashflow state" value={value} onChange={event => setValue(event.target.value)} />;
} }));
vi.mock('./pages/RetirementPage', () => ({ default: function Retirement({ active }: { active: boolean }) {
  const [value, setValue] = useState('Retirement draft');
  return <input data-active={active} aria-label="Retirement state" value={value} onChange={event => setValue(event.target.value)} />;
} }));
import App from './App';
beforeEach(() => { window.history.replaceState(null, '', '/'); });
describe('top-level tabs', () => {
  it('mounts Retirement on first selection and preserves both child states when switching', () => {
    render(<App />);
    expect(screen.queryByLabelText('Retirement state')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Cashflow state'), { target: { value: 'Preserved cashflow' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Retirement' }));
    expect(window.location.hash).toBe('#retirement');
    fireEvent.change(screen.getByLabelText('Retirement state'), { target: { value: 'Preserved retirement' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Cashflow' }));
    expect(screen.getByLabelText('Cashflow state')).toHaveValue('Preserved cashflow');
    expect(screen.getByLabelText('Retirement state')).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('tab', { name: 'Cashflow' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Retirement' }));
    expect(screen.getByLabelText('Retirement state')).toHaveValue('Preserved retirement');
    expect(screen.getByLabelText('Retirement state')).toHaveAttribute('data-active', 'true');
  });
  it('opens a #retirement direct link', () => {
    window.history.replaceState(null, '', '/#retirement');
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Retirement' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Retirement state')).toBeVisible();
    expect(screen.getByLabelText('Cashflow state')).not.toBeVisible();
  });
  it('responds to hash navigation while retaining mounted views', () => {
    render(<App />);
    act(() => {
      window.history.replaceState(null, '', '/#retirement');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByLabelText('Retirement state')).toBeVisible();
    act(() => {
      window.history.replaceState(null, '', '/#cashflow');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByLabelText('Cashflow state')).toBeVisible();
    expect(screen.getByLabelText('Retirement state')).not.toBeVisible();
  });
});
