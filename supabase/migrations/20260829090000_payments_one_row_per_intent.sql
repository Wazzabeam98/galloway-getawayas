-- One payment intent, counted once.
--
-- WHAT THIS IS FIXING. `payments` had nothing stopping the same payment being
-- written twice. Proved by inserting an identical row twice with the service
-- role, which the database accepted, and then end to end: one £150 balance
-- payment handled twice left two succeeded rows for one payment intent and a
-- booking claiming the guest had paid £450 for a £300 stay. See
-- MONEY-IDEMPOTENCY.md for the run.
--
-- THIS MIGRATION GOES FIRST, BEFORE THE CODE THAT RELIES ON IT. The webhook
-- now decides whether a payment has already been counted by whether this index
-- refuses the insert — a 23505 is the signal, not an error. Deploy the code
-- against a database without this index and it silently goes back to
-- double-counting, because nothing ever conflicts.
--
-- WHY REFUNDS ARE EXCLUDED, AND WHY THAT IS NOT A GAP. A booking can genuinely
-- be refunded more than once against one payment intent: a partial refund on
-- cancellation and another later, which app/api/bookings/cancel/route.ts
-- already handles by adding to `alreadyRefunded`. A unique key covering
-- refunds would refuse the second one — turning a bookkeeping fix into a
-- refund that does not happen. Money going out is left alone here.
--
-- WHY NULLS ARE EXCLUDED. The balance job claims an `attempting` row before it
-- has a payment intent to put on it, so those rows carry NULL. Postgres treats
-- NULLs as distinct in a unique index anyway; the WHERE clause says so out
-- loud and keeps the index small.
--
-- WHY status IS IN THE KEY. A payment intent can legitimately appear as
-- `failed` and later as `succeeded`. What must never happen twice is the same
-- intent, same kind, same outcome.
--
-- PRE-FLIGHT — run this first. It must return no rows. If it returns any,
-- those are real double-counted payments that are already in your books, and
-- they need looking at by a person before this index can be created. Do not
-- delete rows to make the index build: work out which booking is wrong first.
--
--   select stripe_payment_intent_id, kind, status, count(*), sum(amount)
--     from public.payments
--    where stripe_payment_intent_id is not null
--      and kind <> 'refund'
--    group by 1, 2, 3
--   having count(*) > 1;
--
-- Safe to run twice.

create unique index if not exists payments_one_row_per_intent
    on public.payments (stripe_payment_intent_id, kind, status)
    where stripe_payment_intent_id is not null
      and kind <> 'refund';

-- Read back:
--   select indexdef from pg_indexes
--    where tablename = 'payments' and indexname = 'payments_one_row_per_intent';
--
-- And prove it bites:
--   insert into public.payments (booking_id, kind, amount, status, stripe_payment_intent_id)
--   values ('<some booking>', 'balance', 1, 'succeeded', 'pi_probe');   -- ok
--   insert into public.payments (booking_id, kind, amount, status, stripe_payment_intent_id)
--   values ('<some booking>', 'balance', 1, 'succeeded', 'pi_probe');   -- 23505
--   delete from public.payments where stripe_payment_intent_id = 'pi_probe';
