-- MoneyOS — core schema, in its own `moneyos` Postgres schema (not `public`)
-- so it's cleanly namespaced from the other apps sharing this Postgres
-- instance (design-andhra-pradesh, workos-personal's storage). Auth is
-- hand-rolled (bcrypt + self-issued JWT in the edge function) — no
-- dependency on Supabase Auth/GoTrue, matching the sibling portfolio/
-- workos-personal/design-andhra-pradesh apps on this box.

create schema if not exists moneyos;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type moneyos.account_type as enum ('cash', 'bank', 'card', 'upi', 'wallet', 'savings', 'credit');
create type moneyos.transaction_type as enum ('expense', 'income', 'transfer');
create type moneyos.category_kind as enum ('expense', 'income');
create type moneyos.payment_method_category as enum ('cash', 'upi', 'card', 'bank', 'other');
create type moneyos.recurring_frequency as enum ('daily', 'weekly', 'monthly', 'yearly');
create type moneyos.loan_status as enum ('active', 'closed');
create type moneyos.payment_status as enum ('pending', 'paid', 'overdue', 'skipped');
create type moneyos.budget_period as enum ('weekly', 'monthly', 'yearly');
create type moneyos.goal_status as enum ('active', 'completed', 'archived');

-- ---------------------------------------------------------------------------
-- users — replaces auth.users entirely, see supabase/functions moneyos routes
-- ---------------------------------------------------------------------------
create table moneyos.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text not null unique,
  password_hash text not null,
  display_name text not null,
  avatar_url text,
  default_currency text not null default 'INR',
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- categories — user_id null = system default, shared by every user
-- ---------------------------------------------------------------------------
create table moneyos.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references moneyos.users(id) on delete cascade,
  name text not null,
  kind moneyos.category_kind not null default 'expense',
  icon text,
  color text,
  parent_category_id uuid references moneyos.categories(id) on delete set null,
  is_system boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index categories_user_id_idx on moneyos.categories(user_id);

-- ---------------------------------------------------------------------------
-- payment_methods — user_id null = system default (Cash, UPI apps, cards, ...)
-- ---------------------------------------------------------------------------
create table moneyos.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references moneyos.users(id) on delete cascade,
  name text not null,
  category moneyos.payment_method_category not null default 'other',
  icon text,
  is_system boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index payment_methods_user_id_idx on moneyos.payment_methods(user_id);

-- ---------------------------------------------------------------------------
-- accounts — wallets (cash/bank/card/upi/savings/credit); current_balance is
-- maintained by the edge function on every transaction write, not a trigger,
-- so balance math + group-expense derivation stay in one auditable place.
-- ---------------------------------------------------------------------------
create table moneyos.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references moneyos.users(id) on delete cascade,
  name text not null,
  type moneyos.account_type not null default 'cash',
  currency text not null default 'INR',
  opening_balance numeric(14,2) not null default 0,
  current_balance numeric(14,2) not null default 0,
  color text,
  icon text,
  is_archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_user_id_idx on moneyos.accounts(user_id);

-- ---------------------------------------------------------------------------
-- recurring_rules — subscriptions, bills, recurring income
-- ---------------------------------------------------------------------------
create table moneyos.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references moneyos.users(id) on delete cascade,
  name text not null,
  type moneyos.transaction_type not null default 'expense',
  category_id uuid references moneyos.categories(id) on delete set null,
  account_id uuid not null references moneyos.accounts(id) on delete cascade,
  payment_method_id uuid references moneyos.payment_methods(id) on delete set null,
  amount numeric(14,2) not null,
  currency text not null default 'INR',
  frequency moneyos.recurring_frequency not null default 'monthly',
  interval_count int not null default 1,
  start_date date not null,
  end_date date,
  next_run_date date not null,
  auto_post boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recurring_rules_user_id_idx on moneyos.recurring_rules(user_id);
create index recurring_rules_next_run_idx on moneyos.recurring_rules(user_id, next_run_date) where is_active;

-- ---------------------------------------------------------------------------
-- loans — EMI/loan tracker; loan_payments (below) is the amortization schedule
-- ---------------------------------------------------------------------------
create table moneyos.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references moneyos.users(id) on delete cascade,
  name text not null,
  lender_name text,
  principal_amount numeric(14,2) not null,
  interest_rate numeric(6,3) not null default 0,
  tenure_months int not null,
  emi_amount numeric(14,2) not null,
  start_date date not null,
  account_id uuid not null references moneyos.accounts(id) on delete restrict,
  category_id uuid references moneyos.categories(id) on delete set null,
  status moneyos.loan_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index loans_user_id_idx on moneyos.loans(user_id);

-- ---------------------------------------------------------------------------
-- transactions — the ledger. `amount` is always what actually hit the
-- account (for a group expense, that's the user's own share only —
-- group_total_amount/group_participant_count/group_reason are kept
-- separately for reporting, e.g. "₹X spent across N group hangouts").
-- occurred_at is a full timestamp (date + time), not just a date.
-- ---------------------------------------------------------------------------
create table moneyos.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references moneyos.users(id) on delete cascade,
  account_id uuid not null references moneyos.accounts(id) on delete restrict,
  transfer_to_account_id uuid references moneyos.accounts(id) on delete restrict,
  category_id uuid references moneyos.categories(id) on delete set null,
  payment_method_id uuid references moneyos.payment_methods(id) on delete set null,
  recurring_rule_id uuid references moneyos.recurring_rules(id) on delete set null,
  type moneyos.transaction_type not null default 'expense',
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'INR',
  description text not null default '',
  notes text,
  tags text[] not null default '{}',
  occurred_at timestamptz not null default now(),
  attachment_url text,
  is_group_expense boolean not null default false,
  group_reason text,
  group_total_amount numeric(14,2),
  group_participant_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_occurred_idx on moneyos.transactions(user_id, occurred_at desc);
create index transactions_user_category_idx on moneyos.transactions(user_id, category_id);
create index transactions_user_account_idx on moneyos.transactions(user_id, account_id);

-- ---------------------------------------------------------------------------
-- loan_payments — generated amortization schedule, one row per installment
-- ---------------------------------------------------------------------------
create table moneyos.loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references moneyos.loans(id) on delete cascade,
  user_id uuid not null references moneyos.users(id) on delete cascade,
  installment_number int not null,
  due_date date not null,
  principal_component numeric(14,2) not null,
  interest_component numeric(14,2) not null,
  remaining_balance numeric(14,2) not null,
  status moneyos.payment_status not null default 'pending',
  paid_date date,
  transaction_id uuid references moneyos.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (loan_id, installment_number)
);
create index loan_payments_loan_due_idx on moneyos.loan_payments(loan_id, due_date);
create index loan_payments_user_status_idx on moneyos.loan_payments(user_id, status, due_date);

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------
create table moneyos.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references moneyos.users(id) on delete cascade,
  category_id uuid references moneyos.categories(id) on delete cascade,
  period moneyos.budget_period not null default 'monthly',
  amount_limit numeric(14,2) not null,
  start_date date not null default (date_trunc('month', now()))::date,
  rollover boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index budgets_user_id_idx on moneyos.budgets(user_id);

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------
create table moneyos.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references moneyos.users(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null,
  current_amount numeric(14,2) not null default 0,
  target_date date,
  linked_account_id uuid references moneyos.accounts(id) on delete set null,
  icon text,
  color text,
  status moneyos.goal_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user_id_idx on moneyos.goals(user_id);

-- ---------------------------------------------------------------------------
-- bills — standalone reminders (not necessarily tied to a recurring_rule)
-- ---------------------------------------------------------------------------
create table moneyos.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references moneyos.users(id) on delete cascade,
  name text not null,
  amount numeric(14,2) not null,
  due_date date not null,
  category_id uuid references moneyos.categories(id) on delete set null,
  recurring_rule_id uuid references moneyos.recurring_rules(id) on delete set null,
  is_paid boolean not null default false,
  paid_transaction_id uuid references moneyos.transactions(id) on delete set null,
  reminder_days_before int not null default 3,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bills_user_due_idx on moneyos.bills(user_id, due_date);

-- ---------------------------------------------------------------------------
-- attachments — receipt metadata; the file itself lives on the CDN path
-- ---------------------------------------------------------------------------
create table moneyos.attachments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references moneyos.transactions(id) on delete cascade,
  user_id uuid not null references moneyos.users(id) on delete cascade,
  url text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index attachments_transaction_id_idx on moneyos.attachments(transaction_id);

-- ---------------------------------------------------------------------------
-- activity_log — lightweight audit trail
-- ---------------------------------------------------------------------------
create table moneyos.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references moneyos.users(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_user_id_idx on moneyos.activity_log(user_id, created_at desc);
