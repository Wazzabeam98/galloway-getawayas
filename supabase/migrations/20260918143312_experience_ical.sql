-- EXPERIENCE iCAL — a provider's calendar, both directions.
--
-- A guest-experience provider runs sessions at times of day, and keeps the rest
-- of their life in some other calendar. Double-booking themselves — a guest at
-- 2pm and a dentist at 2pm — is the thing that embarrasses them in front of a
-- guest. So:
--
--   EXPORT  their bookings, declared sessions and own part-day blocks out, as a
--           secret feed, so they appear in their own calendar with real times.
--   IMPORT  their personal calendar in, so an outside commitment BLOCKS the
--           matching hour here — materialised as ordinary part-day blocks so the
--           existing no-overlap exclusion is the authority (the DB refuses an
--           imported block over a booking, and the guest's booking wins).
--
-- Cottage listings already do the whole-day version of this (listing_ical_feeds,
-- listings.ical_token, /api/cron/ical-sync). Experiences differ only in that a
-- session is hours within a day, not nights: the export carries start/end times
-- and the import blocks hours, not days.

create extension if not exists pgcrypto;

-- 1. THE EXPORT SECRET, per provider (mirrors listings.ical_token). NOT granted
--    to the browser roles: the feed is a live credential — subscribing to it
--    reads the provider's bookings — so it is read only via the service role in
--    the export route. service_providers SELECT is already a column allow-list,
--    so a column added without a grant is hidden by default; we add no grant.
alter table public.service_providers
    add column if not exists ical_token uuid not null default gen_random_uuid();

-- 2. THE IMPORT FEEDS a provider connects — their Google / Apple / Outlook export
--    URL — same shape as listing_ical_feeds. `clashes` is what the last sync could
--    NOT block because a booking (or a declared session) already owned the hour:
--    it is the provider's warning, surfaced in the dashboard.
create table if not exists public.provider_ical_feeds (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.service_providers(id) on delete cascade,
    url text not null,
    label text,
    last_synced_at timestamptz,
    last_status text,
    last_error text,
    failure_count integer not null default 0,
    alerted_at timestamptz,
    clashes jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists provider_ical_feeds_provider_idx
    on public.provider_ical_feeds (provider_id);
create unique index if not exists provider_ical_feeds_unique_url
    on public.provider_ical_feeds (provider_id, url);

alter table public.provider_ical_feeds enable row level security;

-- The provider manages their own feeds from the browser (add/remove), like the
-- cottage host does. The sync writes the status/clashes columns under the service
-- role, which bypasses RLS.
grant select, insert, update, delete on table public.provider_ical_feeds to authenticated;

create policy "providers manage their own calendar feeds" on public.provider_ical_feeds
    using (exists (
        select 1 from public.service_providers sp
        where sp.id = provider_ical_feeds.provider_id and sp.owner_id = auth.uid()
    ))
    with check (exists (
        select 1 from public.service_providers sp
        where sp.id = provider_ical_feeds.provider_id and sp.owner_id = auth.uid()
    ));

-- 3. PROVENANCE on an imported block. A blocked slot_sessions row created by a
--    feed sync carries the feed id; a provider's own hand-made part-day block
--    leaves it null. Two consequences:
--      - the sync replaces only its OWN rows (delete where source_feed_id = feed),
--        so a moved/deleted external event self-heals on the next run;
--      - the part-day block route only ever touches null-provenance rows, so a
--        provider can't hand-delete an imported block — they remove the feed.
--    ON DELETE CASCADE: remove the feed and its imported blocks go with it.
--    Not granted to the browser: only the service-role sync writes it.
alter table public.slot_sessions
    add column if not exists source_feed_id uuid
        references public.provider_ical_feeds(id) on delete cascade;
create index if not exists slot_sessions_source_feed_idx
    on public.slot_sessions (source_feed_id);
