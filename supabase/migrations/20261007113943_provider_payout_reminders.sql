-- Experience providers are live once approved, before their Stripe payouts are
-- set up (Airbnb's model): their share of each booking is held until they are.
-- The hourly /api/cron/experience-payout-reminders emails them that money is
-- waiting — on their first booking, once money is due, then weekly. One row per
-- reminder sent; the insert is the claim that stops a second send (the host
-- side's host_payout_reminders, keyed by provider rather than booking).

create table if not exists "public"."provider_payout_reminders" (
    "provider_id" uuid not null references "public"."service_providers"("id") on delete cascade,
    "kind" text not null check ("kind" ~ '^(first_booking|money_waiting|waiting_week_[0-9]+)$'),
    "sent_at" timestamptz not null default now(),
    primary key ("provider_id", "kind")
);

comment on table "public"."provider_payout_reminders" is
    'One row per payout-setup reminder emailed to an experience provider (first booking, money waiting, weekly). '
    'The insert is the claim that stops a second send. Server role only.';

alter table "public"."provider_payout_reminders" enable row level security;
revoke all on "public"."provider_payout_reminders" from anon, authenticated;
