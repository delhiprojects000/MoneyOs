import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAccounts, useTransactions, useReportsSummary, useLoans, usePendingLoanPayments, useBills } from '@/hooks/useMoneyData';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, formatRelativeDay } from '@/lib/format';
import { ArrowDownRight, ArrowUpRight, Wallet, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { TransactionDialog } from '@/components/transactions/TransactionDialog';
import { DashboardSkeleton } from '@/components/skeletons/pages';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { Transaction } from '@/lib/api';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: recentTx = [] } = useTransactions({ limit: 6 });
  const { data: summary, isLoading: summaryLoading } = useReportsSummary('month');
  const { data: loans = [] } = useLoans();
  const { data: pendingPayments = [] } = usePendingLoanPayments();
  const { data: bills = [] } = useBills();
  const [editingTx, setEditingTx] = useState<Transaction | undefined>(undefined);

  const totalBalance = accounts.reduce((s, a) => s + a.current_balance, 0);
  const currency = user?.default_currency || 'INR';

  // Merge loan installments and standalone bills into one list sorted by
  // actual due date - previously loans always rendered before bills
  // regardless of which was due sooner.
  const upcomingDues = useMemo(() => {
    const loanNameById = Object.fromEntries(loans.map((l) => [l.id, l.name]));
    const nextPaymentPerLoan = new Map<string, (typeof pendingPayments)[number]>();
    for (const p of pendingPayments) if (!nextPaymentPerLoan.has(p.loan_id)) nextPaymentPerLoan.set(p.loan_id, p);

    const loanDues = [...nextPaymentPerLoan.values()].map((p) => ({
      key: `loan-${p.id}`,
      label: `${loanNameById[p.loan_id] ?? 'Loan'} — EMI ${p.installment_number}`,
      amount: p.principal_component + p.interest_component,
      due_date: p.due_date,
    }));
    const billDues = bills.filter((b) => !b.is_paid).map((b) => ({
      key: `bill-${b.id}`,
      label: b.name,
      amount: b.amount,
      due_date: b.due_date,
    }));

    return [...loanDues, ...billDues].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 4);
  }, [loans, pendingPayments, bills]);

  if (accountsLoading || summaryLoading) return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{greeting()}, {user?.display_name?.split(' ')[0]}</h1>
        <p className="text-muted-foreground">Here's where your money stands this month.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile icon={Wallet} label="Total balance" value={formatMoney(totalBalance, currency)} />
        <StatTile icon={ArrowUpRight} label="Income (month)" value={formatMoney(summary?.totals.income ?? 0, currency)} tone="success" />
        <StatTile icon={ArrowDownRight} label="Spent (month)" value={formatMoney(summary?.totals.expense ?? 0, currency)} tone="destructive" />
        <StatTile
          icon={summary && summary.totals.net >= 0 ? TrendingUp : TrendingDown}
          label="Net worth"
          value={formatMoney(summary?.net_worth ?? 0, currency)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Spending trend (this month)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {summary && summary.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.trend}>
                  <defs>
                    <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(8)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v: number) => formatMoney(v, currency)}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="income" stroke="hsl(var(--success))" fill="url(#incomeFill)" strokeWidth={2} />
                  <Area type="monotone" dataKey="expense" stroke="hsl(var(--destructive))" fill="url(#expenseFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No transactions yet this month.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming dues</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingDues.map((d) => (
              <div key={d.key} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-warning" />
                  <span>{d.label}</span>
                </div>
                <div className="text-right">
                  <p className="font-medium tabular-nums">{formatMoney(d.amount, currency)}</p>
                  <p className="text-xs text-muted-foreground">{formatRelativeDay(d.due_date)}</p>
                </div>
              </div>
            ))}
            {upcomingDues.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing due — you're all caught up.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent transactions</CardTitle>
          <Link to="/transactions" className="text-sm text-primary hover:underline">View all</Link>
        </CardHeader>
        <CardContent className="space-y-1">
          {recentTx.length === 0 && <p className="text-sm text-muted-foreground">No transactions yet — add your first one.</p>}
          {recentTx.map((t) => (
            <button
              key={t.id}
              onClick={() => setEditingTx(t)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{t.description || (t.type === 'transfer' ? 'Transfer' : 'Untitled')}</p>
                <p className="text-xs text-muted-foreground">{formatRelativeDay(t.occurred_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                {t.is_group_expense && <Badge variant="secondary">Group</Badge>}
                <span className={`tabular-nums font-medium ${t.type === 'income' ? 'text-success' : t.type === 'expense' ? 'text-destructive' : ''}`}>
                  {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}{formatMoney(t.amount, currency)}
                </span>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {editingTx && <TransactionDialog open={!!editingTx} onOpenChange={(o) => !o && setEditingTx(undefined)} transaction={editingTx} />}
    </div>
  );
}

function StatTile({ icon: Icon, label, value, tone }: { icon: typeof Wallet; label: string; value: string; tone?: 'success' | 'destructive' }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : ''}`}>
            {value}
          </p>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}
