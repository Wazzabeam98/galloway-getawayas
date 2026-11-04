-- A "finish your listing" reminder for a host who started the add-a-listing
-- wizard and left it in draft. One email at about 48 hours, a second at about
-- seven days, and never again once the listing leaves draft. This table is the
-- claim that stops a second send, exactly like host_payout_reminders: the insert
-- of (listing_id, kind) is what a cron run grabs before it emails, and its
-- primary key makes a second insert fail so two overlapping runs can't both go.
--
-- Server role only. The browser never reads or writes it.

create table if not exists "public"."host_draft_reminders" (
    "listing_id" uuid not null references "public"."listings"("id") on delete cascade,
    "kind" text not null check ("kind" in ('first', 'second')),
    "sent_at" timestamptz not null default now(),
    primary key ("listing_id", "kind")
);

comment on table "public"."host_draft_reminders" is
    'One row per "finish your listing" reminder emailed to a host whose listing is '
    'still a draft (first at ~48h, second at ~7d). The insert is the claim that '
    'stops a second send. Server role only.';

alter table "public"."host_draft_reminders" enable row level security;
revoke all on "public"."host_draft_reminders" from anon, authenticated;
