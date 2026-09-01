-- One Stripe transfer, one payout row.
--
-- WHAT THIS STOPS
--
-- `app/api/cron/host-payouts` sends the transfer, then writes the payout row,
-- then stamps `paid_out_at` on the booking. Those are three separate writes
-- and only the first one moves money. If the run dies between them — the
-- 60-second maxDuration expiring mid-loop is the likeliest way — the booking
-- still has `paid_out_at is null`, so tomorrow's run picks it up again.
--
-- Proven on the test project on 31 August 2026: `paid_out_at` was cleared on a
-- booking that had already been transferred, the run was repeated, and Stripe
-- replayed the original transfer (one transfer at Stripe, correctly) while the
-- database gained a SECOND payout row saying the same £360 had been sent. The
-- money moved once and the ledger says twice.
--
-- The replay is what the idempotency key bought us, and it only lasts a day:
-- Stripe forgets an idempotency key after 24 hours and this cron runs every 24
-- hours. Past that window the same retry sends a real second transfer, and the
-- second payout row is no longer a bookkeeping error — it is the record of
-- money that actually left twice.
--
-- WHY THE PREDICATE IS THIS NARROW
--
-- `lib/clawback.ts` writes a `reversal` row carrying the SAME
-- `stripe_transfer_id` as the transfer it reverses — deliberately, because
-- that is what it reversed. A bare unique index on the column would refuse
-- every clawback. So this covers only the rows that mean "money was sent":
-- kind = 'transfer', status = 'succeeded'.
--
-- Rows with no transfer id are untouched. The `withheld` and `failed` rows the
-- payout run writes both have a null there, and several may legitimately exist
-- for one booking.
--
-- PRE-FLIGHT — must return no rows, or the index will refuse to be created:
--
--   select stripe_transfer_id, count(*)
--   from public.payouts
--   where stripe_transfer_id is not null
--     and kind = 'transfer'
--     and status = 'succeeded'
--   group by 1 having count(*) > 1;
--
-- Read on production on 31 August 2026: no rows. The whole table is empty —
-- the payout engine has never run there.
--
-- This is a backstop, not the fix. The fix is the pre-flight read in
-- host-payouts that reconciles an already-sent transfer instead of sending
-- another one. This is here for the same reason
-- `bookings_no_overlapping_confirmed` is: the application check happens before
-- the money moves, and only the database can make the wrong outcome
-- impossible.

create unique index if not exists payouts_one_row_per_transfer
    on public.payouts (stripe_transfer_id)
    where stripe_transfer_id is not null
      and kind = 'transfer'
      and status = 'succeeded';

comment on index public.payouts_one_row_per_transfer is
    'One succeeded transfer row per Stripe transfer. A repeated payout run that '
    'replays the same transfer must not be able to record it as a second payment.';
