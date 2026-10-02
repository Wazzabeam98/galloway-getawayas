-- Host onboarding, Airbnb order: terms recorded at submit, payouts set up after
-- approval.
--
-- 1. WHICH TERMS A HOST AGREED TO, AND WHEN.
--    The holiday-let sign-up never recorded a host's agreement to anything. A
--    host now ticks "I agree to the terms and conditions" before submitting a
--    listing for review, and /api/listings/publish stamps the version they saw
--    and the server's time here. Written by the server only (the publish route,
--    with the service role) — a browser could otherwise claim any version at
--    any date — so both columns are revoked from browser reads and writes like
--    the other account-state columns, and read back through the server.
--
-- 2. A LEDGER OF PAYOUT-SETUP REMINDERS.
--    A listing now goes live on approval whether or not the host has set up
--    payouts (their payouts are held until they do). The host is reminded when
--    a booking arrives and again shortly before that guest checks in. One row
--    per booking and kind, so a reminder is sent once however often the hourly
--    cron runs — the insert is the claim.
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."profiles"
    add column if not exists "host_terms_version" text,
    add column if not exists "host_terms_agreed_at" timestamptz;

comment on column "public"."profiles"."host_terms_version" is
    'Version of the host terms (lib/hostTerms HOST_TERMS_VERSION) this host last agreed to. '
    'Written by /api/listings/publish only. Null = never agreed.';
comment on column "public"."profiles"."host_terms_agreed_at" is
    'Server time the host agreed to host_terms_version. Written by /api/listings/publish only.';

revoke select ("host_terms_version", "host_terms_agreed_at") on "public"."profiles" from anon, authenticated;
revoke insert ("host_terms_version", "host_terms_agreed_at") on "public"."profiles" from anon, authenticated;
revoke update ("host_terms_version", "host_terms_agreed_at") on "public"."profiles" from anon, authenticated;

create table if not exists "public"."host_payout_reminders" (
    "booking_id" uuid not null references "public"."bookings"("id") on delete cascade,
    "kind" text not null check ("kind" in ('booking', 'before_check_in')),
    "sent_at" timestamptz not null default now(),
    primary key ("booking_id", "kind")
);

comment on table "public"."host_payout_reminders" is
    'One row per payout-setup reminder emailed to a host (on booking, before check-in). '
    'The insert is the claim that stops a second send. Server role only.';

alter table "public"."host_payout_reminders" enable row level security;
revoke all on "public"."host_payout_reminders" from anon, authenticated;
