-- Row Level Security: deny-all on every moneyos table, purely as
-- defense-in-depth (matches portfolio/workos-personal, not
-- design-andhra-pradesh's is_admin()-claim policies - that pattern exists
-- because that app has no service_role key available to it; MoneyOS's edge
-- function uses the box's real SERVICE_ROLE_KEY to bypass RLS entirely, same
-- as the managed-Supabase pattern those two apps use). All authorization
-- (user_id ownership) is enforced in the edge function, not here - if a
-- table is reachable at all with just the anon key, that's a bug.
--
-- GRANTs come first and are intentionally broad - Postgres checks GRANTs
-- before RLS ever runs, so anon/authenticated need base privileges to reach
-- the RLS stage at all (PostgREST otherwise 42501s regardless of policies).
grant usage on schema moneyos to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema moneyos to anon, authenticated;
grant all on all tables in schema moneyos to service_role;
grant usage, select on all sequences in schema moneyos to anon, authenticated, service_role;
grant execute on all functions in schema moneyos to anon, authenticated, service_role;
alter default privileges in schema moneyos grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema moneyos grant all on tables to service_role;
alter default privileges in schema moneyos grant execute on functions to anon, authenticated, service_role;

alter table moneyos.users enable row level security;
alter table moneyos.categories enable row level security;
alter table moneyos.payment_methods enable row level security;
alter table moneyos.accounts enable row level security;
alter table moneyos.recurring_rules enable row level security;
alter table moneyos.loans enable row level security;
alter table moneyos.transactions enable row level security;
alter table moneyos.loan_payments enable row level security;
alter table moneyos.budgets enable row level security;
alter table moneyos.goals enable row level security;
alter table moneyos.bills enable row level security;
alter table moneyos.attachments enable row level security;
alter table moneyos.activity_log enable row level security;
-- No policies created on any table: RLS-enabled + zero policies denies all
-- access to anon/authenticated by default. Only the service_role connection
-- (which bypasses RLS by Postgres role privilege, not by policy) can reach
-- these tables - that's the edge function, exclusively.
