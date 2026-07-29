-- Atomic balance adjustment — called via PostgREST RPC
-- (POST /rpc/adjust_account_balance) from the edge function instead of a
-- read-current-balance-then-PATCH round trip in application code, which
-- would race under concurrent requests to the same account.
create or replace function moneyos.adjust_account_balance(p_account_id uuid, p_delta numeric)
returns numeric
language sql
as $$
  update moneyos.accounts
  set current_balance = current_balance + p_delta, updated_at = now()
  where id = p_account_id
  returning current_balance;
$$;
