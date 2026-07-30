import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bell, AlertTriangle, CreditCard, Repeat, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAccounts, useBills, useLoans, usePendingLoanPayments, useRecurringRules } from '@/hooks/useMoneyData';
import { formatMoney, formatRelativeDay } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';

const AUTOPAY_LOOKAHEAD_DAYS = 2; // "notify me 2 days before" - the user's own words

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

interface Reminder {
  key: string;
  icon: typeof Bell;
  label: string;
  amount: number;
  dueDate: string;
  overdue: boolean;
  href: string;
}

export function NotificationsBell() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: accounts = [] } = useAccounts();
  const { data: bills = [] } = useBills();
  const { data: loans = [] } = useLoans();
  const { data: pendingPayments = [] } = usePendingLoanPayments();
  const { data: rules = [] } = useRecurringRules();

  const reminders = useMemo<Reminder[]>(() => {
    const out: Reminder[] = [];
    const today = new Date().getDate();

    for (const b of bills) {
      if (b.is_paid) continue;
      const d = daysUntil(b.due_date);
      if (d <= b.reminder_days_before) out.push({ key: `bill-${b.id}`, icon: AlertTriangle, label: b.name, amount: b.amount, dueDate: b.due_date, overdue: d < 0, href: '/settings' });
    }

    const loanName = Object.fromEntries(loans.map((l) => [l.id, l.name]));
    const seenLoan = new Set<string>();
    for (const p of pendingPayments) {
      if (seenLoan.has(p.loan_id)) continue;
      seenLoan.add(p.loan_id);
      const d = daysUntil(p.due_date);
      if (d <= AUTOPAY_LOOKAHEAD_DAYS) {
        out.push({ key: `loan-${p.id}`, icon: Landmark, label: `${loanName[p.loan_id] ?? 'Loan'} EMI #${p.installment_number}`, amount: p.principal_component + p.interest_component, dueDate: p.due_date, overdue: d < 0, href: '/loans' });
      }
    }

    for (const r of rules) {
      if (!r.is_active || r.auto_post) continue; // auto_post ones settle themselves via process-due
      const d = daysUntil(r.next_run_date);
      if (d <= AUTOPAY_LOOKAHEAD_DAYS) out.push({ key: `rule-${r.id}`, icon: Repeat, label: r.name, amount: r.amount, dueDate: r.next_run_date, overdue: d < 0, href: '/settings' });
    }

    for (const a of accounts) {
      if (a.type !== 'credit' || a.is_archived || !a.billing_day) continue;
      const owed = -a.current_balance;
      if (owed <= 0) continue;
      const settledThisCycle = a.autopay_last_run && a.autopay_last_run.slice(0, 7) === new Date().toISOString().slice(0, 7);
      if (settledThisCycle) continue;
      const daysToDue = a.billing_day - today;
      if (daysToDue <= AUTOPAY_LOOKAHEAD_DAYS) {
        out.push({
          key: `card-${a.id}`, icon: CreditCard,
          label: a.autopay_enabled ? `${a.name} autopay not yet resolved` : `${a.name} bill due`,
          amount: owed, dueDate: '', overdue: daysToDue < 0, href: '/accounts',
        });
      }
    }

    return out.sort((x, y) => Number(y.overdue) - Number(x.overdue));
  }, [accounts, bills, loans, pendingPayments, rules]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {reminders.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {reminders.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-medium">Reminders</p>
          <p className="text-xs text-muted-foreground">Due now or within {AUTOPAY_LOOKAHEAD_DAYS} days</p>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {reminders.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">You're all caught up.</p>}
          {reminders.map((r) => (
            <Link key={r.key} to={r.href} className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
              <div className="flex min-w-0 items-center gap-2">
                <r.icon className={`h-4 w-4 shrink-0 ${r.overdue ? 'text-destructive' : 'text-warning'}`} />
                <span className="truncate">{r.label}</span>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular-nums font-medium">{formatMoney(r.amount, currency)}</p>
                {r.dueDate && <p className={`text-xs ${r.overdue ? 'text-destructive' : 'text-muted-foreground'}`}>{formatRelativeDay(r.dueDate)}</p>}
              </div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
