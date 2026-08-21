-- A record of what an owner did to somebody else's listing, and why.
--
-- Run this on both projects before the code that goes with it deploys.
--
-- No existing table fits. error_log is the only log-shaped one and it is the
-- wrong thing twice over: it records faults rather than deliberate acts, and
-- it has a resolved flag with a screen that clears rows. An audit trail that
-- the person being audited can tidy away is not an audit trail.

create table if not exists "public"."admin_actions" (
    "id"         uuid primary key default gen_random_uuid(),
    "admin_id"   uuid not null references "public"."profiles"("id"),

    "action"     text not null,

    -- SET NULL, deliberately not CASCADE. If the host later deletes the
    -- listing, what was done to it still has to be answerable for.
    "listing_id" uuid references "public"."listings"("id") on delete set null,

    -- Copied in rather than joined. Ownership can change; this says who owned
    -- it at the time, which is the only version that stays true.
    "host_id"    uuid,

    -- The owner types this at the time. Not nullable on purpose: a moderation
    -- log whose reason is optional fills up with blanks within a month.
    "reason"     text not null,

    -- Worked out on the server by diffing the row before and after, never
    -- taken from the browser. Which fields changed, and which photos went.
    "detail"     jsonb not null default '{}'::jsonb,

    "created_at" timestamptz not null default now(),

    constraint "admin_actions_action_check" check ("action" = any (array[
        'listing_hidden'::text,
        'listing_relisted'::text,
        'listing_edited'::text,
        'listing_photo_removed'::text
    ])),
    constraint "admin_actions_reason_not_blank" check (btrim("reason") <> '')
);

create index if not exists "admin_actions_listing_idx" on "public"."admin_actions" ("listing_id", "created_at" desc);
create index if not exists "admin_actions_created_idx" on "public"."admin_actions" ("created_at" desc);

-- Service role only. The admin screens read it back through a server route,
-- so no browser ever needs to reach this table directly.
alter table "public"."admin_actions" enable row level security;
revoke all on "public"."admin_actions" from "anon", "authenticated";
grant all on "public"."admin_actions" to "service_role";

comment on table "public"."admin_actions" is
    'What an owner did to a listing that was not theirs, and the reason they '
    'gave at the time. Written only when admin_id <> host_id.';
