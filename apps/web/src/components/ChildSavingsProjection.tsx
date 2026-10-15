import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RetirementChildSavings } from '@floaters/types';
import { DEFAULT_CHILD_GROWTH, projectChildSavings } from '@/lib/child-savings';

const money = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(amount);

export function ChildSavingsProjection({ savings }: { savings: RetirementChildSavings }) {
  const rows = projectChildSavings(savings);
  if (!rows) return <p className="mt-2 rounded-md bg-iris/5 p-2 text-xs text-muted-foreground">{savings.ageAtBalanceDate === undefined ? 'Add the child’s age at the balance date to see a projection to 18.' : 'Check the savings inputs to see the projection to 18.'}</p>;
  const final = rows[rows.length - 1];
  const jisaGrowth = savings.jisaAnnualReturn ?? DEFAULT_CHILD_GROWTH;
  const uniGrowth = savings.universityAnnualReturn ?? DEFAULT_CHILD_GROWTH;
  return <section aria-label="Child savings projection" className="mt-2">
    <div className="grid grid-cols-3 gap-2 rounded-lg bg-iris/5 p-2.5 text-xs">
      <div><p className="font-semibold text-muted-foreground">JISA at 18</p><p className="text-lg font-bold tabular-nums">{money(final.jisa)}</p></div>
      <div><p className="font-semibold text-muted-foreground">Uni fund at 18</p><p className="text-lg font-bold tabular-nums">{money(final.universityFund)}</p></div>
      <div><p className="font-semibold text-muted-foreground">Total · ~{final.year}</p><p className="text-lg font-bold tabular-nums">{money(final.total)}</p></div>
    </div>
    <div className="mt-2 h-40 min-w-0" role="img" aria-label="Projected JISA and uni fund balances through age 18">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="age" tickLine={false} minTickGap={15} tickFormatter={age => `${age}`} />
        <YAxis width={48} domain={[0, 'auto']} tickLine={false} tickFormatter={value => `£${Math.round(Number(value) / 1000)}k`} />
        <Tooltip formatter={(value: unknown) => money(Number(value))} labelFormatter={age => `Age ${age} · ~${rows.find(row => row.age === Number(age))?.year}`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="jisa" name="JISA" stroke="hsl(var(--iris-deep))" strokeWidth={2} dot={rows.length === 1} isAnimationActive={false} />
        <Line type="monotone" dataKey="universityFund" name="Uni fund" stroke="hsl(var(--coral))" strokeWidth={2} dot={rows.length === 1} isAnimationActive={false} />
      </LineChart></ResponsiveContainer>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">Illustration in future pounds: {(jisaGrowth * 100).toFixed(1)}% JISA / {(uniGrowth * 100).toFixed(1)}% uni annual growth after fees, before any tax. {money(savings.monthlyUniContribution ?? 0)}/month into the uni fund; JISA grows without new payments. Approximate timing from age at balance date.</p>
  </section>;
}
