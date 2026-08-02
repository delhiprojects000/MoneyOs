import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCategories, useReportsSummary } from '@/hooks/useMoneyData';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, formatDayMonth } from '@/lib/format';
import { ReportsSkeleton } from '@/components/skeletons/pages';
import { UNCATEGORIZED_KEY } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const PIE_COLORS = ['#059669', '#0284c7', '#ea580c', '#7c3aed', '#e11d48', '#d97706', '#0d9488', '#db2777', '#84cc16', '#64748b'];
// Uncategorised spend always reads as the same neutral grey rather than
// borrowing a category's colour from the palette.
const UNCATEGORIZED_COLOR = '#94a3b8';

export default function Reports() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const [range, setRange] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const { data: summary, isLoading } = useReportsSummary(range);
  const { data: categories = [] } = useCategories('expense');

  // Longer ranges come back bucketed by month instead of by day, so the axis
  // has to label them differently ("Aug" vs "14").
  const byMonth = summary?.range.granularity === 'month';
  const formatBucket = (d: string) => (byMonth ? formatDayMonth(`${d}-01`).replace(/^\d+\s/, '') : String(Number(d.slice(8))));

  const categoryName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const categoryData = Object.entries(summary?.by_category ?? {})
    .map(([id, amount]) => ({
      id,
      name: id === UNCATEGORIZED_KEY ? 'Uncategorized' : categoryName[id] || 'Other',
      value: amount,
    }))
    .sort((a, b) => b.value - a.value)
    .map((c, i) => ({ ...c, color: c.id === UNCATEGORIZED_KEY ? UNCATEGORIZED_COLOR : PIE_COLORS[i % PIE_COLORS.length] }));

  const uncategorized = summary?.by_category?.[UNCATEGORIZED_KEY] ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-muted-foreground">See where your money actually goes.</p>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as typeof range)}>
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? <ReportsSkeleton /> : (
      <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryTile label="Income" value={formatMoney(summary?.totals.income ?? 0, currency)} tone="success" />
        <SummaryTile label="Expense" value={formatMoney(summary?.totals.expense ?? 0, currency)} tone="destructive" />
        <SummaryTile label="Net" value={formatMoney(summary?.totals.net ?? 0, currency)} />
        <SummaryTile label="Group spend" value={formatMoney(summary?.totals.group_expense_total ?? 0, currency)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Income vs expense</CardTitle></CardHeader>
          <CardContent className="h-72">
            {summary && summary.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.trend}>
                  <XAxis dataKey="date" tickFormatter={formatBucket} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip formatter={(v: number) => formatMoney(v, currency)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="income" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Spend by category</CardTitle></CardHeader>
          <CardContent className="h-72">
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {/* paddingAngle > 0 with exactly one slice makes Recharts draw a
                      degenerate sliver instead of a full ring - only pad when there's
                      more than one category to actually separate. */}
                  <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={categoryData.length > 1 ? 2 : 0}>
                    {categoryData.map((c) => <Cell key={c.id} fill={c.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatMoney(v, currency)} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Category breakdown</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {categoryData.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </div>
              <span className="tabular-nums font-medium">{formatMoney(c.value, currency)}</span>
            </div>
          ))}
          {categoryData.length === 0 && <p className="text-sm text-muted-foreground">Nothing spent in this period yet.</p>}
          {uncategorized > 0 && (
            <p className="pt-1 text-xs text-muted-foreground">
              {formatMoney(uncategorized, currency)} of this has no category yet - set one on those transactions (or on the subscription that posts them) to split it out.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Budget vs actual</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(summary?.budgets ?? []).map((b) => {
            const pct = Math.min(100, Math.round((b.spent / b.amount_limit) * 100));
            return (
              <div key={b.id} className="text-sm">
                <div className="mb-1 flex justify-between">
                  <span>{b.category_id ? categoryName[b.category_id] || 'Category' : 'Overall'}</span>
                  <span className={b.spent > b.amount_limit ? 'text-destructive' : 'text-muted-foreground'}>
                    {formatMoney(b.spent, currency)} / {formatMoney(b.amount_limit, currency)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${b.spent > b.amount_limit ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {(summary?.budgets ?? []).length === 0 && <p className="text-sm text-muted-foreground">No active budgets to compare.</p>}
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'destructive' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-lg font-semibold tabular-nums ${tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyChart() {
  return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Nothing to show yet.</p>;
}
