// Shared "what money is about to move" logic - used by both the Dashboard's
// upcoming-dues card and the NotificationsBell, so a loan installment,
// subscription, standalone bill, or credit card bill only has one place that
// decides its due date/amount/overdue-ness instead of two drifting copies.
import type { Account, Bill, Loan, LoanPayment, RecurringRule } from './api';

export type UpcomingKind = 'loan' | 'bill' | 'recurring' | 'credit_card';

export interface UpcomingItem {
  key: string;
  kind: UpcomingKind;
  label: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  overdue: boolean;
  href: string;
}

export function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// A card with any amount owed always has an outstanding bill for *this*
// billing cycle - due this month's billing_day, whether that's still ahead
// (upcoming) or already past (overdue). There's no "push to next month"
// case here: once it's paid off (owed <= 0), the caller excludes it entirely
// rather than this function guessing at a future cycle.
function creditCardDueDate(billingDay: number, from = new Date()): string {
  return new Date(from.getFullYear(), from.getMonth(), billingDay).toISOString().slice(0, 10);
}

export function buildUpcomingItems(params: {
  accounts: Account[];
  bills: Bill[];
  loans: Loan[];
  pendingPayments: LoanPayment[];
  rules: RecurringRule[];
}): UpcomingItem[] {
  const { accounts, bills, loans, pendingPayments, rules } = params;
  const out: UpcomingItem[] = [];

  for (const b of bills) {
    if (b.is_paid) continue;
    out.push({ key: `bill-${b.id}`, kind: 'bill', label: b.name, amount: b.amount, dueDate: b.due_date, overdue: daysUntil(b.due_date) < 0, href: '/loans' });
  }

  const loanName = Object.fromEntries(loans.map((l) => [l.id, l.name]));
  const seenLoan = new Set<string>();
  for (const p of pendingPayments) {
    if (seenLoan.has(p.loan_id)) continue;
    seenLoan.add(p.loan_id);
    out.push({
      key: `loan-${p.id}`, kind: 'loan',
      label: `${loanName[p.loan_id] ?? 'Loan'} - EMI ${p.installment_number}`,
      amount: p.principal_component + p.interest_component,
      dueDate: p.due_date, overdue: daysUntil(p.due_date) < 0, href: '/loans',
    });
  }

  for (const r of rules) {
    if (!r.is_active) continue;
    out.push({ key: `rule-${r.id}`, kind: 'recurring', label: r.name, amount: r.amount, dueDate: r.next_run_date, overdue: daysUntil(r.next_run_date) < 0, href: '/loans' });
  }

  for (const a of accounts) {
    if (a.type !== 'credit' || a.is_archived || !a.billing_day) continue;
    const owed = Math.max(0, -a.current_balance);
    if (owed <= 0) continue;
    const dueDate = creditCardDueDate(a.billing_day);
    out.push({ key: `card-${a.id}`, kind: 'credit_card', label: `${a.name} bill`, amount: owed, dueDate, overdue: daysUntil(dueDate) < 0, href: '/accounts' });
  }

  return out.sort((x, y) => x.dueDate.localeCompare(y.dueDate));
}
