-- The running total of what a host owes us must only ever change inside the
-- database.
--
-- Three places moved it, and all three did the same thing: read
-- profiles.payout_balance_owed into JavaScript, add or subtract there, write
-- the result back. Between the read and the write, anything else that touched
-- the same row was lost.
--
--   lib/clawback.ts            carryForward(), a shortfall we could not reverse
--   app/api/stripe/refund      the 5% host-cancellation penalty
--   app/api/cron/host-payouts  its own decrement, after recovering a debt
--
-- Proved on the test project: two debts of £40 and £25 arriving together left
-- £40. The £25 was read, added to a stale zero, and overwritten.
--
-- The payout run has the widest window of the three by far. It reads the total
-- BEFORE calling Stripe to make the transfer and writes the new one AFTER that
-- call returns, so the gap is a network round trip to Stripe. Any debt landing
-- in it is overwritten by a figure read before the money moved. That does not
-- need volume — it needs one refund while the daily run is going.
--
-- Both directions are wrong in a way that costs somebody real money: a lost
-- clawback means a debt vanishes and the host keeps money they owed us, and a
-- lost decrement means the debt stays and the host is charged for it twice.
--
-- So the arithmetic moves to where the row is locked. `update ... set x = x +
-- $1` reads and writes inside one statement, and Postgres serialises two of
-- them against the same row. There is no window left to lose anything in.

create or replace function public.adjust_payout_balance(
    p_host  uuid,
    p_delta numeric
)
returns numeric
language plpgsql
security definer
-- SECURITY DEFINER runs as the owner and ignores the caller's grants, so the
-- search_path is pinned rather than taken from whoever is calling.
set search_path = public
as $fn$
declare
    new_balance numeric;
begin
    update public.profiles
       set payout_balance_owed = greatest(
               0,
               round(coalesce(payout_balance_owed, 0) + p_delta, 2)
           )
     where id = p_host
    returning payout_balance_owed into new_balance;

    -- Nobody by that id. The caller gets null and can say so, rather than a
    -- cheerful zero that reads like a host who owes nothing.
    if not found then
        return null;
    end if;

    return new_balance;
end;
$fn$;

-- A debt can never go below zero. Without the clamp, two payout runs
-- overlapping would each subtract the same recovery and leave a negative
-- balance — and the payout run reads that balance back as
-- `Math.min(owed, hostShare)`, so a negative would make the deduction
-- negative and pay the host MORE than their share. The clamp is what stops a
-- double recovery turning into an overpayment.
--
-- It is not silent. The payout run compares the balance it gets back against
-- the one it expected: LOWER than expected means something else took the same
-- debt off at the same time, and it is reported. Higher is fine and expected —
-- that is a new debt landing while the transfer was in flight, which is exactly
-- what this change stopped losing.

-- SECURITY DEFINER functions are granted to PUBLIC by default, which would put
-- a function that edits a money column within reach of the browser key. The
-- money columns are revoked from the browser roles; the function that writes
-- them has to be as well.
revoke all on function public.adjust_payout_balance(uuid, numeric) from public;
revoke all on function public.adjust_payout_balance(uuid, numeric) from anon;
revoke all on function public.adjust_payout_balance(uuid, numeric) from authenticated;
