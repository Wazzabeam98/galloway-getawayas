-- referrals: three types (stay, experience, trade)
--
-- WHAT THIS IS FOR. The referral scheme (20261022111408) rewarded referring a
-- HOST only. It now covers all three things a person can run on the platform —
-- a holiday let (stay), a guest experience, or a host trade/service — each with
-- its own reward: £50 / £25 / £15. The reward falls due after the referred
-- person's first completed booking (stay or experience) or first paid month
-- (trade), and for a stay or experience their first booking's commission is
-- waived in the payout. A trade's own offer is six months free, so a referred
-- trade gets nothing extra and nothing is waived — only the referrer is paid.
--
-- WHAT THIS CHANGES on public.referrals:
--   + type            which kind of referral (stay/experience/trade). Null until
--                     the referred person takes their first qualifying action;
--                     set then, and the reward amount follows from it.
--   + waived_order_id  the experience order (service_orders) whose commission was
--                     waived, the experience twin of waived_booking_id (bookings).
--                     Each is set only for its own type; a trade sets neither.
--   ~ status           renamed to type-neutral values so they read right for an
--                     experience or a trade, not just a stay:
--                       listed          -> active       (they listed/created/registered)
--                       first_stay_done -> reward_due    (first booking/month done)
--                     invited and reward_paid are unchanged.
--
-- The scheme shipped days ago with no referrals in flight, so the handful of
-- possible rows are migrated in place; the CHECK is dropped, the rows rewritten,
-- and the new CHECK added, in one transaction.
--
-- WHO MAY READ-WRITE IT. Unchanged: SERVICE ROLE ONLY (RLS on, no policies, no
-- browser grant — tests/table-grants-guard.test.ts). The browser never touches
-- it. reward_amount/waived_commission remain money columns that never leave the
-- database toward a browser.
--
-- PRE-FLIGHT. Not destructive: two added columns, a renamed set of status
-- values on rows that do not meaningfully exist yet, and the two CHECKs
-- replaced. Nothing is dropped that holds data.

-- The experience order a waiver applied to. Its own ON DELETE SET NULL, matching
-- waived_booking_id, so removing an order never deletes the reward record.
alter table public.referrals
    add column if not exists waived_order_id uuid references public.service_orders (id) on delete set null;

-- Which kind of referral. Null while 'invited' (we don't yet know what they'll
-- do); set to one of the three when they take their first qualifying action.
alter table public.referrals
    add column if not exists type text;

alter table public.referrals
    drop constraint if exists referrals_type_check;
alter table public.referrals
    add constraint referrals_type_check
    check (type is null or type in ('stay', 'experience', 'trade'));

-- Rename the two middle status values to type-neutral ones. Drop the CHECK
-- first (it forbids the new values), rewrite the rows, then add the new CHECK.
-- Any pre-rework row was a stay, so it also gets type='stay'.
alter table public.referrals
    drop constraint if exists referrals_status_check;

update public.referrals set status = 'active'      where status = 'listed';
update public.referrals set status = 'reward_due'  where status = 'first_stay_done';
update public.referrals set type = 'stay' where type is null and status in ('active', 'reward_due', 'reward_paid');

alter table public.referrals
    add constraint referrals_status_check
    check (status in ('invited', 'active', 'reward_due', 'reward_paid'));

comment on column public.referrals.type is
    'stay | experience | trade — set when the referred person takes their first qualifying action; the reward amount (£50/£25/£15) follows from it. Null while invited.';
comment on column public.referrals.waived_order_id is
    'The experience order (service_orders) whose commission was waived, for type=experience. The stay twin is waived_booking_id. A trade sets neither.';

notify pgrst, 'reload schema';

-- Read back:
--   select column_name from information_schema.columns where table_name='referrals' and column_name in ('type','waived_order_id') order by column_name;  -- both present
--   select conname from pg_constraint where conrelid='public.referrals'::regclass and conname in ('referrals_status_check','referrals_type_check');       -- both present
