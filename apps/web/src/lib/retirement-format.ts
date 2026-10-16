import type { RetirementAssetKey } from '@floaters/types';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
export const retirementMoney = (value: number) => currency.format(value);
export const RETIREMENT_ASSET_LABEL: Record<RetirementAssetKey, string> = { pension: 'Pension', isa: 'ISA', investments: 'Investments', cash: 'Cash' };
