// Single client for the `moneyos` Edge Function - every read/write in the
// app goes through this instead of calling Postgres/PostgREST directly,
// mirroring the sibling portfolio/workos-personal projects' src/lib/api.ts.

import { getToken, clearToken } from './authToken';

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/moneyos`;

async function call(path: string, init: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${FUNCTIONS_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (res.status === 401) {
    clearToken();
    throw new Error('Your session has expired. Please log in again.');
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function jsonCall(path: string, method: string, body?: unknown) {
  return call(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

// Minutes east of UTC (330 for IST). Every date bucket the backend computes -
// "today", "this month", a card's statement cycle - is a calendar date in the
// user's own timezone, but occurred_at is an absolute timestamp and the
// backend container runs on UTC. Sending this with anything date-bucketed is
// what keeps a 1am expense inside today instead of yesterday.
export const tzOffsetMinutes = () => -new Date().getTimezoneOffset();

// --- Types ------------------------------------------------------------

export type AccountType = 'cash' | 'bank' | 'card' | 'upi' | 'wallet' | 'savings' | 'credit';
export type TransactionType = 'expense' | 'income' | 'transfer';
export type CategoryKind = 'expense' | 'income';
export type PaymentMethodCategory = 'cash' | 'upi' | 'card' | 'bank' | 'other';
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type LoanStatus = 'active' | 'closed';
export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'skipped';
export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';
export type GoalStatus = 'active' | 'completed' | 'archived';

export interface User {
  id: string;
  email?: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  default_currency: string;
  created_at?: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  currency: string;
  opening_balance: number;
  current_balance: number;
  color: string | null;
  icon: string | null;
  is_archived: boolean;
  sort_order: number;
  // Credit card terms - only meaningful when type === 'credit'. Spending on
  // a credit account drives current_balance negative through the normal
  // expense flow (see backend applyBalanceEffect) - these fields just
  // describe the card's own limit/statement-cycle/autopay behavior on top of
  // that. statement_day closes a cycle, due_day is when that closed cycle has
  // to be paid; see CreditCardStatement below.
  credit_limit: number | null;
  statement_day: number | null;
  due_day: number | null;
  autopay_enabled: boolean;
  autopay_account_id: string | null;
  autopay_last_run: string | null;
  last_settled_statement: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id: string | null;
  name: string;
  kind: CategoryKind;
  icon: string | null;
  color: string | null;
  parent_category_id: string | null;
  is_system: boolean;
  sort_order: number;
}

export interface PaymentMethod {
  id: string;
  user_id: string | null;
  name: string;
  category: PaymentMethodCategory;
  icon: string | null;
  is_system: boolean;
  sort_order: number;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  transfer_to_account_id: string | null;
  category_id: string | null;
  payment_method_id: string | null;
  recurring_rule_id: string | null;
  type: TransactionType;
  amount: number;
  currency: string;
  description: string;
  notes: string | null;
  tags: string[];
  occurred_at: string;
  attachment_url: string | null;
  is_group_expense: boolean;
  group_reason: string | null;
  group_total_amount: number | null;
  group_participant_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringRule {
  id: string;
  user_id: string;
  name: string;
  type: TransactionType;
  category_id: string | null;
  account_id: string;
  payment_method_id: string | null;
  amount: number;
  currency: string;
  frequency: RecurringFrequency;
  interval_count: number;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  auto_post: boolean;
  is_active: boolean;
  notes: string | null;
  last_run_date: string | null;
  // The cycle (a past next_run_date) this rule was last posted for - "paid
  // for August", as opposed to last_run_date's "posted on the 2nd".
  last_posted_period: string | null;
}

export interface Loan {
  id: string;
  user_id: string;
  name: string;
  lender_name: string | null;
  principal_amount: number;
  interest_rate: number;
  tenure_months: number;
  emi_amount: number;
  start_date: string;
  account_id: string;
  category_id: string | null;
  status: LoanStatus;
  notes: string | null;
}

export interface LoanPayment {
  id: string;
  loan_id: string;
  user_id: string;
  installment_number: number;
  due_date: string;
  principal_component: number;
  interest_component: number;
  remaining_balance: number;
  status: PaymentStatus;
  paid_date: string | null;
  transaction_id: string | null;
}

export interface Budget {
  id: string;
  user_id: string;
  category_id: string | null;
  period: BudgetPeriod;
  amount_limit: number;
  start_date: string;
  rollover: boolean;
  is_active: boolean;
}

export interface Goal {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  linked_account_id: string | null;
  icon: string | null;
  color: string | null;
  status: GoalStatus;
  notes: string | null;
}

export interface Bill {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_date: string;
  category_id: string | null;
  recurring_rule_id: string | null;
  is_paid: boolean;
  paid_transaction_id: string | null;
  reminder_days_before: number;
  notes: string | null;
}

// One credit card's current billing cycle, computed server-side (see
// "Credit card statement cycles" in the edge function). The statement is
// what's actually due on due_date; unbilled_spend is everything swiped after
// the statement closed, which belongs to next month's bill instead.
export interface CreditCardStatement {
  account_id: string;
  name: string;
  currency: string;
  statement_day: number | null;
  due_day: number | null;
  period_start: string | null;
  statement_date: string | null;
  due_date: string | null;
  next_statement_date: string | null;
  next_due_date: string | null;
  statement_balance: number;
  amount_due: number;
  cycle_spend: number;
  unbilled_spend: number;
  paid_since_statement: number;
  current_balance: number;
  credit_limit: number | null;
  owed: number;
  autopay_enabled: boolean;
  settled: boolean;
}

export interface ReportsSummary {
  range: { range: string; start: string; end: string; granularity: 'day' | 'month' };
  totals: { income: number; expense: number; net: number; group_expense_total: number };
  by_category: Record<string, number>;
  trend: Array<{ date: string; income: number; expense: number }>;
  net_worth: number;
  total_balance: number;
  loan_outstanding: number;
  budgets: Array<Budget & { spent: number }>;
}

// --- Auth ---------------------------------------------------------------

export const auth = {
  signup: (email: string, username: string, password: string, display_name?: string): Promise<{ token: string; user: User }> =>
    jsonCall('/auth/signup', 'POST', { email, username, password, display_name }),

  login: (username: string, password: string): Promise<{ token: string; user: User }> =>
    jsonCall('/auth/login', 'POST', { username, password }),

  me: async (): Promise<User> => (await call('/auth/me')).user,

  updateMe: async (patch: Partial<Pick<User, 'display_name' | 'avatar_url' | 'default_currency'>>): Promise<User> =>
    (await jsonCall('/auth/me', 'PATCH', patch)).user,
};

// --- Generic data gateway -------------------------------------------------

type DataTable = 'categories' | 'payment_methods' | 'accounts' | 'recurring_rules' | 'loans' | 'budgets' | 'goals' | 'bills' | 'attachments' | 'loan_payments';

async function dataSelect<T>(table: DataTable, opts: { filters?: Record<string, unknown>; order?: string; limit?: number } = {}): Promise<T[]> {
  return (await jsonCall('/data', 'POST', { table, operation: 'select', ...opts })).data;
}
async function dataInsert<T>(table: DataTable, payload: unknown): Promise<T> {
  return (await jsonCall('/data', 'POST', { table, operation: 'insert', payload })).data;
}
async function dataUpdate<T>(table: DataTable, id: string, payload: unknown): Promise<T> {
  return (await jsonCall('/data', 'POST', { table, operation: 'update', id, payload })).data;
}
async function dataDelete(table: DataTable, id: string): Promise<void> {
  await jsonCall('/data', 'POST', { table, operation: 'delete', id });
}

export const categories = {
  list: (kind?: CategoryKind) => dataSelect<Category>('categories', { filters: kind ? { kind } : undefined, order: 'sort_order.asc' }),
  create: (payload: Partial<Category>) => dataInsert<Category>('categories', payload),
  update: (id: string, payload: Partial<Category>) => dataUpdate<Category>('categories', id, payload),
  remove: (id: string) => dataDelete('categories', id),
};

export const paymentMethods = {
  list: () => dataSelect<PaymentMethod>('payment_methods', { order: 'sort_order.asc' }),
  create: (payload: Partial<PaymentMethod>) => dataInsert<PaymentMethod>('payment_methods', payload),
  update: (id: string, payload: Partial<PaymentMethod>) => dataUpdate<PaymentMethod>('payment_methods', id, payload),
  remove: (id: string) => dataDelete('payment_methods', id),
};

export const accounts = {
  list: () => dataSelect<Account>('accounts', { order: 'sort_order.asc' }),
  create: (payload: Partial<Account>) => dataInsert<Account>('accounts', payload),
  update: (id: string, payload: Partial<Account>) => dataUpdate<Account>('accounts', id, payload),
  remove: (id: string) => dataDelete('accounts', id),
  transfer: (from_account_id: string, to_account_id: string, amount: number, description?: string): Promise<{ data: Transaction }> =>
    jsonCall('/accounts/transfer', 'POST', { from_account_id, to_account_id, amount, description }),
};

export const recurringRules = {
  list: () => dataSelect<RecurringRule>('recurring_rules', { order: 'next_run_date.asc' }),
  create: (payload: Partial<RecurringRule>) => dataInsert<RecurringRule>('recurring_rules', payload),
  update: (id: string, payload: Partial<RecurringRule>) => dataUpdate<RecurringRule>('recurring_rules', id, payload),
  remove: (id: string) => dataDelete('recurring_rules', id),
  // Manual "mark this cycle paid" - posts a transaction for the rule's
  // current next_run_date and advances the schedule by one interval.
  // `period` is the cycle the caller believes it's settling (the
  // next_run_date it was showing); the server rejects it with a 409 if the
  // rule has already moved past it, so a double-click can't post two cycles.
  post: (id: string, period?: string): Promise<{ data: RecurringRule; transaction: Transaction }> =>
    jsonCall(`/recurring_rules/${id}/post`, 'POST', { period }),
};

export const creditCards = {
  statements: (): Promise<CreditCardStatement[]> =>
    call(`/credit-cards/statements?tz_offset=${tzOffsetMinutes()}`).then((r) => r.data),
};

// Catch-up pass for auto_post recurring rules and credit-card autopay -
// there's no cron on the box, so this is called once per session on app
// load instead (see useProcessDue in useMoneyData.ts).
export const processDue = {
  run: (): Promise<{ posted_recurring: Transaction[]; autopay_settled: Transaction[] }> =>
    jsonCall(`/process-due?tz_offset=${tzOffsetMinutes()}`, 'POST'),
};

export const budgets = {
  list: () => dataSelect<Budget>('budgets'),
  create: (payload: Partial<Budget>) => dataInsert<Budget>('budgets', payload),
  update: (id: string, payload: Partial<Budget>) => dataUpdate<Budget>('budgets', id, payload),
  remove: (id: string) => dataDelete('budgets', id),
};

export const goals = {
  list: () => dataSelect<Goal>('goals'),
  create: (payload: Partial<Goal>) => dataInsert<Goal>('goals', payload),
  update: (id: string, payload: Partial<Goal>) => dataUpdate<Goal>('goals', id, payload),
  remove: (id: string) => dataDelete('goals', id),
};

export const bills = {
  list: () => dataSelect<Bill>('bills', { order: 'due_date.asc' }),
  create: (payload: Partial<Bill>) => dataInsert<Bill>('bills', payload),
  update: (id: string, payload: Partial<Bill>) => dataUpdate<Bill>('bills', id, payload),
  remove: (id: string) => dataDelete('bills', id),
};

// --- Transactions (dedicated, balance-affecting routes) --------------------

export interface CreateTransactionInput {
  account_id: string;
  transfer_to_account_id?: string;
  category_id?: string;
  payment_method_id?: string;
  type: TransactionType;
  amount: number;
  currency?: string;
  description?: string;
  notes?: string;
  tags?: string[];
  occurred_at?: string;
  is_group_expense?: boolean;
  group_reason?: string;
  group_total_amount?: number;
  group_participant_count?: number;
}

export const transactions = {
  list: (params: { from?: string; to?: string; account_id?: string; category_id?: string; type?: TransactionType; search?: string; limit?: number } = {}): Promise<Transaction[]> => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) usp.set(k, String(v));
    return call(`/transactions?${usp.toString()}`).then((r) => r.data);
  },
  create: (payload: CreateTransactionInput): Promise<Transaction> => jsonCall('/transactions', 'POST', payload).then((r) => r.data),
  update: (id: string, payload: Partial<CreateTransactionInput>): Promise<Transaction> => jsonCall(`/transactions/${id}`, 'PATCH', payload).then((r) => r.data),
  remove: (id: string): Promise<void> => jsonCall(`/transactions/${id}`, 'DELETE').then(() => undefined),
};

// --- Loans / EMI -----------------------------------------------------------

export interface CreateLoanInput {
  name: string;
  lender_name?: string;
  principal_amount: number;
  interest_rate?: number;
  tenure_months: number;
  emi_amount: number;
  start_date: string;
  account_id: string;
  category_id?: string;
  notes?: string;
}

export const loans = {
  list: () => dataSelect<Loan>('loans'),
  create: (payload: CreateLoanInput): Promise<{ data: Loan; schedule: LoanPayment[] }> => jsonCall('/loans', 'POST', payload),
  // Dedicated route, not the generic /data gateway - changing
  // principal/rate/tenure/EMI/start_date needs the unpaid tail of the
  // amortization schedule regenerated server-side (see backend handleUpdateLoan).
  update: (id: string, payload: Partial<CreateLoanInput>): Promise<{ data: Loan; schedule?: LoanPayment[] }> => jsonCall(`/loans/${id}`, 'PATCH', payload),
  remove: (id: string) => dataDelete('loans', id),
  schedule: (loanId: string): Promise<LoanPayment[]> => call(`/loans/${loanId}/schedule`).then((r) => r.data),
  payInstallment: (loanId: string, paymentId: string): Promise<{ data: LoanPayment; transaction: Transaction }> =>
    jsonCall(`/loans/${loanId}/payments/${paymentId}/pay`, 'POST'),
  // Soonest unpaid installment per loan, for merging into a single
  // "upcoming dues" list alongside standalone bills - one query instead of
  // one schedule fetch per loan.
  pendingPayments: () => dataSelect<LoanPayment>('loan_payments', { filters: { status: 'neq.paid' }, order: 'due_date.asc' }),
};

// --- Reports -----------------------------------------------------------

// The key by_category uses for expenses with no category set - they're real
// spend and belong in the chart, just under their own bucket.
export const UNCATEGORIZED_KEY = 'uncategorized';

export const reports = {
  summary: (range: 'day' | 'week' | 'month' | 'year' | 'custom' = 'month', start?: string, end?: string): Promise<ReportsSummary> => {
    const usp = new URLSearchParams({ range, tz_offset: String(tzOffsetMinutes()) });
    if (start) usp.set('start', start);
    if (end) usp.set('end', end);
    return call(`/reports/summary?${usp.toString()}`);
  },
};

// --- Upload (receipts) ------------------------------------------------

export const upload = {
  receipt: async (file: File): Promise<string> => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${crypto.randomUUID()}-${safeName}`;
    const buffer = await file.arrayBuffer();
    const token = getToken();
    const res = await fetch(`${FUNCTIONS_BASE}/upload`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-file-name': fileName,
        'Content-Type': 'application/octet-stream',
      },
      body: buffer,
    });
    if (res.status === 401) { clearToken(); throw new Error('Your session has expired. Please log in again.'); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
    return body.url as string;
  },
};
