-- Taking five days of test-mode writes back out of the production database.
--
-- WHAT HAPPENED
--
-- Production ran the Stripe TEST key from 17 to 22 August 2026. Vercel records
-- STRIPE_SECRET_KEY on the production target as created 17 August and updated
-- 22 August, and the event log agrees exactly: public.stripe_events holds 190
-- test-mode events received 16-20 August and 24 live-mode events on 21-22
-- August, with no test-mode event after the switch.
--
-- So this was not stray webhook endpoints leaking into production. The
-- production site itself was in test mode, and both the app and the webhook
-- wrote test-mode results into the production database for five days. Two
-- test-mode webhook endpoints pointing at the production URL were deleted on
-- 31 August; they were a symptom.
--
-- WHAT IS BEING REMOVED, AND WHAT IS DELIBERATELY NOT
--
-- Removed:
--
--   * 11 rows in public.payments dated 16-20 August. Seven 'succeeded'
--     totalling £677.50 and four 'failed' totalling £397.50. None of it is
--     money that ever moved.
--   * 1 row in public.payouts for -£0.05, status 'owed', with no booking. The
--     payout engine has never been run, and this row would otherwise be the
--     first thing it ever read. A negative amount owed is not what it should
--     cut its teeth on.
--
-- NOT removed, on purpose:
--
--   * The five bookings. Every one is already 'cancelled' / 'unpaid' with
--     amount_paid 0.00, so they assert nothing false. Deleting rows a guest
--     might one day ask about, to tidy a table, is the wrong trade.
--   * The four live payments from 21 August totalling £3.50. Small, but real
--     money genuinely taken during a live smoke test, and a real payment is
--     not test data however small it is.
--   * The connected account on public.profiles. It is a genuine LIVE account —
--     it is not visible under the test key — so stripe_payouts_enabled on it
--     is correct.
--   * public.stripe_events. It is the log of what actually arrived, and a log
--     that has been edited to look tidier is worse than no log. The test-mode
--     rows in it are the evidence for this migration.
--
-- WHY THE PAYMENTS ARE DELETED BY ID AND NOT BY DATE
--
-- `where created_at::date <= '2026-08-20'` selects the same eleven rows today
-- and is the wrong statement to leave in a file. It is a predicate about time,
-- and this is not a decision about time — it is a decision about eleven
-- specific rows somebody has looked at. Run against a restored backup, or a
-- database where the clock or the data differs, a date predicate does
-- something nobody chose. The ids cannot.
--
-- Every one of the eleven was checked to be an orphan: booking_id is null, so
-- none is inflating any booking's balance. The delete asserts that again
-- rather than trusting it, so a row that has been attached to a booking since
-- this was written survives instead of vanishing.
--
-- PRE-FLIGHT — run this and read it before applying:
--
--   select 'payments to delete' as what, count(*), sum(amount) as total
--     from public.payments
--    where id in (
--      '31db5600-5018-455c-b637-5cfde70ddc48', '186abd7a-3d41-423e-a2d7-7c0adcf4a4cf',
--      '100a36f7-7cd7-4154-b2a0-a9d7864bbb81', 'a48b2e51-d6ca-47f2-9eb2-2484c7bbf91f',
--      '105c298c-ab7f-4341-bd04-3fe135ddc8f6', 'a9be774b-b3dd-4f5d-a033-59fd89182431',
--      'e93a1ae9-d952-4740-895d-2787a7795298', 'f84f2c45-5052-4bc9-8a72-52a41a80639a',
--      '2cafce96-cb76-49e0-9801-afb3791bc58c', '59369b54-2aa8-4c9e-8308-31b9d0eb5899',
--      '928e07aa-ed6d-4ba4-bee2-acd59fc2c08a')
--   union all
--   select 'of those, attached to a booking', count(*), null
--     from public.payments
--    where id in (...same list...) and booking_id is not null
--   union all
--   select 'payout to delete', count(*), sum(amount)
--     from public.payouts where id = 'da6d2ffb-508b-44d9-9f0d-20adf0d0e318';
--
-- Expected: 11 payments totalling 1075.00, NONE attached to a booking, and one
-- payout of -0.05. If the middle number is not zero, stop and look.
--
-- DESTRUCTIVE. scripts/migrate.mjs requires --destructive on top of --apply.
-- Production only: these rows do not exist on test.

delete from "public"."payments"
 where "id" in (
    '31db5600-5018-455c-b637-5cfde70ddc48',
    '186abd7a-3d41-423e-a2d7-7c0adcf4a4cf',
    '100a36f7-7cd7-4154-b2a0-a9d7864bbb81',
    'a48b2e51-d6ca-47f2-9eb2-2484c7bbf91f',
    '105c298c-ab7f-4341-bd04-3fe135ddc8f6',
    'a9be774b-b3dd-4f5d-a033-59fd89182431',
    'e93a1ae9-d952-4740-895d-2787a7795298',
    'f84f2c45-5052-4bc9-8a72-52a41a80639a',
    '2cafce96-cb76-49e0-9801-afb3791bc58c',
    '59369b54-2aa8-4c9e-8308-31b9d0eb5899',
    '928e07aa-ed6d-4ba4-bee2-acd59fc2c08a'
 )
   -- Belt and braces. If any of these has been attached to a booking since the
   -- ids were captured, it is no longer the row this file was written about.
   and "booking_id" is null;

delete from "public"."payouts"
 where "id" = 'da6d2ffb-508b-44d9-9f0d-20adf0d0e318'
   and "booking_id" is null
   -- The amount is part of the identity here: this is the -0.05 clawback
   -- artefact, and if the row under that id is now something else, it stays.
   and "amount" = -0.05;

-- READ BACK:
--
--   select (select count(*) from public.payments) as payments,
--          (select sum(amount) from public.payments) as payments_total,
--          (select count(*) from public.payouts) as payouts,
--          (select count(*) from public.bookings) as bookings;
--
-- Expected afterwards: 4 payments totalling 3.50 (the live smoke tests), 0
-- payouts, and 5 bookings still there.
