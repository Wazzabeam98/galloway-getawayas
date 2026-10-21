-- Clear a stale £0.05 payout_balance_owed residue on one production profile.
--
-- WHAT WAS FOUND (production, read-only, 2026-10-21).
--   * One profile has payout_balance_owed <> 0: 7738220e-4580-476b-9704-
--     b7fc2499fe67 (Liam's own account, used to walk the host side), at £0.05.
--   * That host has ZERO rows in public.payouts of any status — no 'owed'
--     itemised debt, no settled or paid history. Nothing justifies the £0.05.
--   * error_log holds no clawback/refund money-failure for this host; the only
--     entries are benign admin provider-category events.
--
-- WHY IT IS THERE. Every current writer of payout_balance_owed (lib/clawback,
-- api/stripe/refund, api/cron/host-payouts) bumps the running total through the
-- atomic adjust_payout_balance RPC and, in the same path, writes a matching
-- public.payouts ledger row. No ledger row exists here, so no current code path
-- produced it. The £0.05 is pre-ledger residue: a value left on the raw column
-- during early manual testing on Liam's own account, before debts were itemised
-- into public.payouts and before the atomic RPC existed (the ledger/atomic work
-- post-dates PAYOUT-BALANCE-TRACE.md, 31 Aug 2026).
--
-- WHY IT MATTERS. The payout run OBEYS this number (PAYOUT-BALANCE-TRACE.md): it
-- deducts payout_balance_owed from the host's share before transferring, without
-- recomputing from the rows. So this unjustified £0.05 would be silently taken
-- off Liam's first real payout. Small, but on the money path, and exactly the
-- kind of drift the admin panel's site-wide warning can miss per host.
--
-- THE CORRECTION. Reconcile the running total DOWN to the itemised outstanding
-- debt, which is the figure the number is supposed to mirror. For this host the
-- itemised outstanding is £0.00, so the total goes to £0.00.
--
-- Guarded so it can only ever touch this residue and never a real balance:
--   * scoped to the one host id above;
--   * only when the stored total is a tiny residue (between £0.01 and £1.00);
--   * only when it disagrees with the itemised outstanding, so re-running is a
--     no-op (idempotent);
--   * computed in a single UPDATE statement — the row is locked for the write,
--     and the new value is the itemised sum, never a stale read-add-write.
--
-- Not --destructive (an UPDATE of one numeric column, no data loss). Applied to
-- PRODUCTION from this branch via scripts/migrate.mjs with the read-back below.
-- A no-op on TEST, where this host id does not exist.

update public.profiles p
set payout_balance_owed = sub.itemised
from (
    select pr.id,
           coalesce((
               select sum(greatest(
                   abs(pay.amount)
                   - coalesce(pay.settled_amount, 0)
                   - coalesce(pay.waived_amount, 0), 0))
               from public.payouts pay
               where pay.host_id = pr.id
                 and pay.status = 'owed'
           ), 0) as itemised
    from public.profiles pr
    where pr.id = '7738220e-4580-476b-9704-b7fc2499fe67'
) sub
where p.id = sub.id
  and p.payout_balance_owed between 0.01 and 1.00
  and p.payout_balance_owed <> sub.itemised;

-- Read back — the residue must be gone and agree with the itemised rows:
--   select payout_balance_owed from public.profiles
--    where id = '7738220e-4580-476b-9704-b7fc2499fe67';
--   -- expected: 0
