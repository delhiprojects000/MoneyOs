// Shared "what money is about to move" logic - used by both the Dashboard's
// upcoming-dues card and the NotificationsBell, so a loan installment,
// subscription, standalone bill, or credit card bill only has one place that
// decides its due date/amount/overdue-ness instead of two drifting copies.
import type { Bill, CreditCardStatement, Loan, LoanPayment, RecurringRule } from './api';
import { formatCyclePeriod } from './format';

export type UpcomingKind = 'loan' | 'bill' | 'recurring' | 'credit_card';

export interface UpcomingItem {
  key: string;
  kind: UpcomingKind;
  label: string;
  /** Which cycle/month this covers, when that isn't obvious from the label. */
  period?: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  overdue: boolean;
  href: string;
}

export function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const target = new Date(y, m - 1, d);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function buildUpcomingItems(params: {
  bills: Bill[];
  loans: Loan[];
  pendingPayments: LoanPayment[];
  rules: RecurringRule[];
  cardStatements: CreditCardStatement[];
}): UpcomingItem[] {
  const { bills, loans, pendingPayments, rules, cardStatements } = params;
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
    out.push({
      key: `rule-${r.id}`, kind: 'recurring', label: r.name,
      period: formatCyclePeriod(r.frequency, r.next_run_date),
      amount: r.amount, dueDate: r.next_run_date, overdue: daysUntil(r.next_run_date) < 0, href: '/loans',
    });
  }

  // Only the *closed* statement is a due - spend made after the statement
  // date sits in unbilled_spend and isn't owed until next cycle's due date,
  // even though it's already on the card's balance.
  for (const s of cardStatements) {
    if (s.amount_due <= 0 || !s.due_date) continue;
    out.push({
      key: `card-${s.account_id}`, kind: 'credit_card', label: `${s.name} bill`,
      period: s.statement_date ? `${formatCyclePeriod('monthly', s.statement_date)} statement` : undefined,
      amount: s.amount_due, dueDate: s.due_date, overdue: daysUntil(s.due_date) < 0, href: '/accounts',
    });
  }

  return out.sort((x, y) => x.dueDate.localeCompare(y.dueDate));
}
