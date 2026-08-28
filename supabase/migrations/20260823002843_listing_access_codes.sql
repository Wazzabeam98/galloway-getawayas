-- The door code for a property.
--
-- Deliberately NOT a column on `listings`. Five places read that table with
-- `select('*')`, one of them the public listing page — so a column there would
-- be pulled into the page's server data and serialised into the page source.
-- The obvious defence does not work either: Postgres refuses `select *`
-- outright when a column has been revoked, which would break the public page,
-- the listing wizard, the edit screen, the save route and account settings all
-- at once.
--
-- A separate table with no grants is unreachable from a browser by
-- construction, rather than by everybody remembering not to select it.
--
-- Read in exactly three places, all server-side with the service role: the
-- scheduled-message sender filling {lockbox_code}, the listing editor so a
-- host can set it, and nothing else. It is never sent to a guest except inside
-- the check-in message itself.
--
-- Safe to run twice.
--
-- PRE-FLIGHT — expect 0 rows:
--
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name = 'listing_access_codes';

create table if not exists public.listing_access_codes (
    -- One code per property, so the listing is the key.
    listing_id  uuid primary key references public.listings (id) on delete cascade,
    code        text not null,
    updated_at  timestamptz not null default now(),
    -- Who last changed it. A door code is a credential; knowing who set it is
    -- part of being able to answer for it later.
    updated_by  uuid
);

comment on table public.listing_access_codes is
    'Door/lockbox codes, one per listing. Service role only — never exposed to a browser. Reaches a guest solely inside the check-in message.';

-- Locked down completely. There is no policy for `authenticated` on purpose:
-- a host sets this through a server route that checks can_listing, and a guest
-- never reads the table at all.
alter table public.listing_access_codes enable row level security;

revoke all on public.listing_access_codes from anon;
revoke all on public.listing_access_codes from authenticated;
