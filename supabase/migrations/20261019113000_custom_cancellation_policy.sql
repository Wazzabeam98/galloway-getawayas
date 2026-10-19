-- Custom cancellation policy, and the non-refundable choice, stamped per booking.
--
-- WHAT THIS DOES, AND WHY, IN ONE TRANSACTION (migrate.mjs wraps the file)
--
-- 1) The booking gains its OWN copy of the cancellation terms, the way it already
--    carries commission_rate and cleaning_fee. Until now the refund rule read
--    listings.cancellation_policy LIVE, so a host changing their policy would
--    silently rewrite the terms of a stay already booked and paid for. From now
--    the checkout route stamps the policy — and, for Custom, the host's day count
--    — onto the booking, and every refund path reads the stamp. A booking's
--    history stays true to what was agreed at the time.
--
--      bookings.cancellation_policy        text,     stamped at checkout
--      bookings.cancellation_custom_days   integer,  stamped only when Custom
--      bookings.non_refundable             boolean,  the guest's checkout choice
--
--    All three are service-role-stamped by /api/stripe/checkout and NOT granted
--    to the browser roles — a guest cannot write their own refund terms. (The
--    non-refundable CHOICE travels in the checkout request body, like `plan`, and
--    is only honoured when the listing actually offers the option; the server
--    writes the authoritative value here.)
--
--    ORDERING INSIDE THIS FILE MATTERS. Existing bookings are backfilled from
--    their listing's CURRENT policy FIRST (step 2), before any listing's policy
--    is changed (step 6). So an in-flight or past booking keeps exactly the terms
--    it had; only FUTURE bookings on a re-defaulted listing see the new policy.
--
-- 2) 'Custom' becomes a fifth listing policy: the host sets ONE whole number of
--    days (1–365). Full refund more than that many days before check-in, nothing
--    within it — no 50% band (lib/cancellation.ts ruleFor/refundDue).
--
--      listings.cancellation_custom_days   integer, default 30
--      the cancellation_policy CHECK is widened to allow 'Custom'
--
-- 3) THE DEFAULT CHANGES, FOR NEW LISTINGS ONLY. A brand-new listing now
--    defaults to Custom / 30 days (no refund within 30 days of check-in) instead
--    of Moderate. EXISTING listings are NOT touched: on production 'Moderate' was
--    the old column default, so a listing sitting on it cannot be told apart from
--    a host who chose Moderate on purpose, and silently re-writing a live
--    listing's refund terms is not something to guess at. Every existing listing
--    keeps whatever policy it has now; the owner reviews them with the hosts
--    directly (the report lists each one). Only `created_at`-from-now listings get
--    the new default, through the column DEFAULT below.
--
-- PRE-FLIGHT: none destructive. Adds nullable/defaulted columns and widens a
-- CHECK (never narrows — no existing row can fail it). No existing listing's
-- policy is changed. No data is lost; --destructive is NOT required and must
-- never be used. Safe to run on test first, then production.

-- ---------------------------------------------------------------------------
-- 1) The booking's own copy of the terms.
-- ---------------------------------------------------------------------------
alter table public.bookings
    add column if not exists cancellation_policy text,
    add column if not exists cancellation_custom_days integer,
    add column if not exists non_refundable boolean not null default false;

-- Mirror the listings CHECK, but allow NULL (a booking made before this column
-- existed, which the refund rule reads as Moderate via policyOf()).
alter table public.bookings
    drop constraint if exists bookings_cancellation_policy_check;
alter table public.bookings
    add constraint bookings_cancellation_policy_check
    check (
        cancellation_policy is null
        or cancellation_policy in ('Flexible', 'Moderate', 'Limited', 'Firm', 'Custom')
    );

-- A Custom day count, when present, is a whole number 1–365 — the same rule the
-- shared validator enforces client- and server-side (lib/cancellation.ts
-- cancelDaysProblem). NULL is allowed for every non-Custom booking.
alter table public.bookings
    drop constraint if exists bookings_cancellation_custom_days_check;
alter table public.bookings
    add constraint bookings_cancellation_custom_days_check
    check (
        cancellation_custom_days is null
        or (cancellation_custom_days >= 1 and cancellation_custom_days <= 365)
    );

comment on column public.bookings.cancellation_policy is
    'The cancellation policy stamped on this booking by /api/stripe/checkout and '
    'never rewritten, so a later change to the listing cannot alter the terms of '
    'a stay already agreed. Null on bookings made before the column existed, read '
    'as Moderate by lib/cancellation.ts policyOf().';
comment on column public.bookings.cancellation_custom_days is
    'For a Custom policy only: the whole number of days (1–365) before check-in '
    'after which no refund is due. Stamped at checkout beside cancellation_policy; '
    'null for the four fixed tiers.';
comment on column public.bookings.non_refundable is
    'The guest chose the cheaper non-refundable rate at checkout. Stamped by '
    '/api/stripe/checkout (service role); a guest cancelling such a booking is '
    'refunded nothing — see lib/cancellation.ts refundDue(). Never browser-writable.';

-- ---------------------------------------------------------------------------
-- 2) Backfill the booking copy from the listing's CURRENT policy, BEFORE any
--    listing policy is changed below. Existing bookings keep their terms.
-- ---------------------------------------------------------------------------
update public.bookings b
    set cancellation_policy = l.cancellation_policy
    from public.listings l
    where b.listing_id = l.id
      and b.cancellation_policy is null;

-- ---------------------------------------------------------------------------
-- 3) The listing's Custom day count. Default 30 fills every existing row; it is
--    read only when the policy is 'Custom', so a value on a non-Custom listing is
--    harmless and simply sits ready if the host later switches to Custom.
-- ---------------------------------------------------------------------------
alter table public.listings
    add column if not exists cancellation_custom_days integer not null default 30;

alter table public.listings
    drop constraint if exists listings_cancellation_custom_days_check;
alter table public.listings
    add constraint listings_cancellation_custom_days_check
    check (cancellation_custom_days >= 1 and cancellation_custom_days <= 365);

comment on column public.listings.cancellation_custom_days is
    'For a Custom cancellation_policy only: the whole number of days (1–365) '
    'before check-in after which no refund is due. Written by the listing editor '
    'through /api/listings/save (service role), never a direct browser UPDATE — '
    'platform-only, like cancellation_policy. Public-readable so the listing page '
    'can show the host''s number before booking.';

-- ---------------------------------------------------------------------------
-- 4) Widen the policy CHECK to allow 'Custom' (never narrows — widen before a new
--    value is written, per the house rule).
-- ---------------------------------------------------------------------------
alter table public.listings
    drop constraint if exists listings_cancellation_policy_check;
alter table public.listings
    add constraint listings_cancellation_policy_check
    check (cancellation_policy in ('Flexible', 'Moderate', 'Limited', 'Firm', 'Custom'));

-- ---------------------------------------------------------------------------
-- 5) New listings default to Custom / 30 days. Existing rows are NOT changed by
--    altering a column default — this only affects rows inserted from now on.
--    No backfill of existing listings: their current policy stands (see note 3).
-- ---------------------------------------------------------------------------
alter table public.listings
    alter column cancellation_policy set default 'Custom';

-- ---------------------------------------------------------------------------
-- 6) Let the browser read the new listings column (public, like cancellation_policy).
--    The SELECT allow-list was set in 20260903154419; add this column by name.
-- ---------------------------------------------------------------------------
grant select (cancellation_custom_days) on public.listings to authenticated;

-- PostgREST caches the schema; nudge it so the new column is readable at once.
notify pgrst, 'reload schema';

-- Read back (what to confirm on apply):
--   select id, title, cancellation_policy, cancellation_custom_days from public.listings order by created_at;
--   -- every existing listing keeps the policy it had; no row is converted. New
--   -- listings inserted after this will default to Custom / 30.
--   select column_default from information_schema.columns
--    where table_name='listings' and column_name='cancellation_policy';
--   -- expected: 'Custom'::text
--   select column_name from information_schema.column_privileges
--    where table_name='listings' and grantee='authenticated'
--      and privilege_type='SELECT' and column_name='cancellation_custom_days';
--   -- expected: one row.
