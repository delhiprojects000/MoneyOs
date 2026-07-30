-- Credit card modeling + autopay/auto-post tracking.
--
-- Credit card balances reuse the existing signed current_balance convention
-- (see 0001's comment on moneyos.accounts) rather than a separate "owed"
-- column: a `type = 'credit'` account starts at 0 and an expense transaction
-- against it already drives current_balance negative via the existing
-- applyBalanceEffect/adjust_account_balance path, so "spend on credit cuts
-- the credit account, not cash" falls out of the current transaction model
-- for free. What's new here is just the card's own terms (limit, due day)
-- and where its bill gets auto-paid from.
alter table moneyos.accounts
  add column credit_limit numeric(14,2),
  add column billing_day int check (billing_day between 1 and 28),
  add column autopay_enabled boolean not null default false,
  add column autopay_account_id uuid references moneyos.accounts(id) on delete set null,
  add column autopay_last_run date;

-- recurring_rules.auto_post already exists (0001) but had no processing
-- logic behind it - last_run_date lets /process-due tell "already posted
-- this cycle" apart from "due and still pending" without re-deriving it from
-- next_run_date math every request.
alter table moneyos.recurring_rules
  add column last_run_date date;
