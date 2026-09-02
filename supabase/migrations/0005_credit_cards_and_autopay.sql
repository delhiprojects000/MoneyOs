-- Credit card modelling and autopay.
--
-- Card balances reuse the signed current_balance convention rather than a
-- separate "owed" column: an expense against a credit account already drives
-- the balance negative through the ordinary transaction path. What is new here
-- is the card's own terms and where its bill is paid from.
alter table moneyos.accounts
  add column credit_limit numeric(14,2),
  add column billing_day int check (billing_day between 1 and 28),
  add column autopay_enabled boolean not null default false,
  add column autopay_account_id uuid references moneyos.accounts(id) on delete set null,
  add column autopay_last_run date;

-- last_run_date lets /process-due distinguish "already posted this cycle" from
-- "due and still pending" without re-deriving it from next_run_date each time.
alter table moneyos.recurring_rules
  add column last_run_date date;
