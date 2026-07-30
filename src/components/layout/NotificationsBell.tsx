import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bell, AlertTriangle, CreditCard, Repeat, Landmark, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAccounts, useBills, useLoans, usePendingLoanPayments, useRecurringRules } from '@/hooks/useMoneyData';
import { formatMoney, formatRelativeDay } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { buildUpcomingItems, daysUntil, type UpcomingKind } from '@/lib/upcoming';
import { useDismissedReminders } from '@/hooks/useDismissedReminders';

const REMINDER_LOOKAHEAD_DAYS = 2; // "notify me 2 days before" - the user's own words

const KIND_ICON: Record<UpcomingKind, typeof Bell> = {
  loan: Landmark, bill: AlertTriangle, recurring: Repeat, credit_card: CreditCard,
};

export function NotificationsBell() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: accounts = [] } = useAccounts();
  const { data: bills = [] } = useBills();
  const { data: loans = [] } = useLoans();
  const { data: pendingPayments = [] } = usePendingLoanPayments();
  const { data: rules = [] } = useRecurringRules();
  const { isDismissed, dismiss, dismissAll } = useDismissedReminders();

  const allReminders = useMemo(() => {
    // auto_post rules settle themselves via process-due with no action
    // needed from the user, so they're excluded here - Dashboard's upcoming
    // list still shows them since that's meant to be a full picture.
    const nonAutoRules = rules.filter((r) => !r.auto_post);
    const autopayByAccount = Object.fromEntries(accounts.map((a) => [a.id, a.autopay_enabled]));
    const items = buildUpcomingItems({ accounts, bills, loans, pendingPayments, rules: nonAutoRules });
    return items
      .filter((i) => daysUntil(i.dueDate) <= REMINDER_LOOKAHEAD_DAYS)
      .map((i) => i.kind === 'credit_card'
        ? { ...i, label: autopayByAccount[i.key.replace('card-', '')] ? `${i.label} - autopay not yet resolved` : i.label }
        : i);
  }, [accounts, bills, loans, pendingPayments, rules]);

  // Each key already embeds the specific due date (loan payment id, bill id,
  // or the rule/card id) - dismissing it only hides *this* occurrence, so it
  // naturally reappears once the due date moves on to the next cycle.
  const reminders = useMemo(
    () => allReminders.filter((r) => !isDismissed(r.key)).sort((x, y) => Number(y.overdue) - Number(x.overdue)),
    [allReminders, isDismissed],
  );

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
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Reminders</p>
            <p className="text-xs text-muted-foreground">Due now or within {REMINDER_LOOKAHEAD_DAYS} days</p>
          </div>
          {reminders.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => dismissAll(reminders.map((r) => r.key))}>
              Clear all
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {reminders.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">You're all caught up.</p>}
          {reminders.map((r) => {
            const Icon = KIND_ICON[r.kind];
            return (
              <div key={r.key} className="group flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
                <Link to={r.href} className="flex min-w-0 flex-1 items-center gap-2">
                  <Icon className={`h-4 w-4 shrink-0 ${r.overdue ? 'text-destructive' : 'text-warning'}`} />
                  <span className="truncate">{r.label}</span>
                </Link>
                <div className="shrink-0 text-right">
                  <p className="tabular-nums font-medium">{formatMoney(r.amount, currency)}</p>
                  <p className={`text-xs ${r.overdue ? 'text-destructive' : 'text-muted-foreground'}`}>{formatRelativeDay(r.dueDate)}</p>
                </div>
                <button
                  className="shrink-0 rounded-full p-1 text-muted-foreground opacity-100 hover:bg-background hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
                  onClick={() => dismiss(r.key)}
                  title="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
