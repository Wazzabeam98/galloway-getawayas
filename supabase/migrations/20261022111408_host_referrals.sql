-- host referrals
--
-- WHAT THIS IS FOR. A host referral scheme, Airbnb's shape. Any signed-in user
-- gets a personal referral link; someone who opens it and goes on to list a
-- property of their own is recorded as referred by them. When that referred
-- host's FIRST stay completes (is paid out, so not cancelled and not refunded
-- to nothing), two things happen at once: the referred host's first booking has
-- its commission waived in the payout (rate forced to 0 in the host-payouts
-- cron, so feeAmount is 0 and the host keeps the whole collected amount), and a
-- £50 reward becomes due to the referrer, which an owner pays by bank transfer
-- and marks paid at /admin/referrals.
--
-- WHAT GOES WRONG WITHOUT IT. There is nowhere to record who referred whom that
-- survives sign-up, and nowhere to hold the reward ledger the owner pays from.
-- A reward or a waiver worked out on the fly, with no row to claim against,
-- double-pays the moment two payout runs overlap — the same failure the
-- host_payout_reminders claim-row was added to stop.
--
-- TWO TABLES.
--   referral_codes      one row per user: their stable personal link code.
--   referrals           one row per referred person: who referred them, how far
--                       the referral has got (invited → listed → first stay done
--                       → reward paid), and the reward/waiver figures.
--
-- WHO MAY READ-WRITE THEM. SERVICE ROLE ONLY. RLS on, no policies, every grant
-- to anon and authenticated revoked (tests/table-grants-guard.test.ts). The
-- browser never touches either table directly: a referrer sees their own
-- referrals through the server-rendered /refer page (service role, filtered to
-- their own referrer_id), the link code is minted server-side, the referral is
-- attached server-side (the auth callback and the listings/publish route), the
-- commission is waived and the reward stamped in the host-payouts cron, and an
-- owner marks a reward paid through /api/admin/referrals (is_admin checked on
-- the server). reward_amount is a money column and never leaves the database
-- towards a browser, which the service-role-only decision keeps true by
-- construction. first_wins and no-self-referral are enforced in the SQL below
-- (a unique referred_user_id, and a CHECK that referrer <> referred).
--
-- PERSONAL DATA. Neither table stores any: only account references (uuids),
-- status, money figures and timestamps. A closed account is anonymised rather
-- than deleted, so its uuid stays but resolves to a scrubbed profile with no
-- name — nothing readable is left here to clear, so admin_anonymise_account is
-- deliberately NOT patched. The reward ledger is left intact on purpose: it is
-- the other party's record of money owed or paid.
--
-- PRE-FLIGHT. Not destructive: two new tables, their indexes, RLS and grants.
-- Nothing is dropped or rewritten.

-- ---------------------------------------------------------------- referral_codes

create table if not exists public.referral_codes (
    -- The user whose link this is. One code per person, for life.
    user_id uuid primary key references public.profiles (id) on delete cascade,
    -- The short token in the link (/refer/<code>). Unique across everyone so a
    -- code resolves to exactly one referrer. Minted server-side in lib/referrals.
    code text not null unique,
    created_at timestamptz not null default now()
);

alter table public.referral_codes enable row level security;
revoke all on table public.referral_codes from anon;
revoke all on table public.referral_codes from authenticated;
grant select, insert, update, delete on table public.referral_codes to service_role;

comment on table public.referral_codes is
    'One stable personal referral-link code per user. Service role only; minted and read by lib/referrals through server routes, never by the browser.';

-- ---------------------------------------------------------------- referrals

create table if not exists public.referrals (
    id uuid primary key default gen_random_uuid(),
    -- Who gets the £50 — the owner of the link that was opened.
    referrer_id uuid not null references public.profiles (id) on delete cascade,
    -- The new host who was referred. UNIQUE, so the FIRST referral to attach to
    -- a person wins and a later link cannot overwrite it.
    referred_user_id uuid not null unique references public.profiles (id) on delete cascade,
    -- invited      referred person has an account but has not listed yet
    -- listed       they have submitted a listing of their own (first into review)
    -- first_stay_done  their first stay has completed and been paid out; the
    --                  booking's commission was waived and the reward is now due
    -- reward_paid  the owner has paid the referrer their £50 by bank transfer
    status text not null default 'invited'
        check (status in ('invited', 'listed', 'first_stay_done', 'reward_paid')),
    -- The referrer's reward in pounds, stamped when it becomes due. A money
    -- column: never granted to a browser role.
    reward_amount numeric,
    -- The referred host's first booking, whose commission was waived. Set when
    -- the reward becomes due. Nulled rather than cascaded if that booking is
    -- ever removed, so the reward record survives.
    waived_booking_id uuid references public.bookings (id) on delete set null,
    -- What that waived 10% commission would have come to, for the owner's
    -- records. A money column.
    waived_commission numeric,
    reward_due_at timestamptz,
    reward_paid_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- A link can't refer its own owner.
    constraint referrals_no_self check (referrer_id <> referred_user_id)
);

-- The referrer's own /refer page lists their referrals newest first.
create index if not exists referrals_referrer_idx
    on public.referrals (referrer_id, created_at desc);

-- The host-payouts cron asks, per booking, "is this host's referral still
-- 'listed' (waiver not yet taken)?" — a lookup by referred_user_id.
create index if not exists referrals_referred_idx
    on public.referrals (referred_user_id);

-- The admin page lists rewards that are due but not yet paid.
create index if not exists referrals_status_idx
    on public.referrals (status);

alter table public.referrals enable row level security;
revoke all on table public.referrals from anon;
revoke all on table public.referrals from authenticated;
grant select, insert, update, delete on table public.referrals to service_role;

comment on table public.referrals is
    'One row per referred host: referrer, referred user (unique = first-wins), status (invited/listed/first_stay_done/reward_paid), and the reward/waiver figures. Service role only; attached by the auth callback and listings/publish, waived+stamped by the host-payouts cron, marked paid at /api/admin/referrals. CHECK stops self-referral.';

notify pgrst, 'reload schema';

-- Read back:
--   select relname, relrowsecurity from pg_class where relname in ('referral_codes','referrals') order by relname;  -- both true
--   select count(*) from information_schema.role_table_grants
--    where table_name in ('referral_codes','referrals') and grantee in ('anon','authenticated');  -- 0
--   select count(*) from pg_policies where tablename in ('referral_codes','referrals');  -- 0
