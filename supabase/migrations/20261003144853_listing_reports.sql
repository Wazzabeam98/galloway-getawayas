-- Reports a guest (or a signed-out visitor) raises about a listing.
--
-- The guest-facing flow mirrors Airbnb's "Report this listing": a reason from a
-- short fixed list, then a line of detail. It is NOT a money dispute and NOT a
-- chargeback — it is "something about this listing is wrong, have a look". It
-- lands in the owner tools alongside the money queues and emails the directors,
-- the same way a chargeback does.
--
-- Its own table rather than columns on `listings`, for the same reason
-- `disputes` is its own table: one listing can be reported many times, each
-- report carries its own reason, detail and reporter, and — the deciding
-- reason here — a report NAMES the person who made an accusation about someone
-- else's property. That must never be readable out of the browser, by the host
-- it concerns least of all. So, like `disputes`, the whole table is walled:
-- RLS on, no grant to `anon` or `authenticated`. Every read and write goes
-- through the service role in /api/listings/report and /admin/listing-reports.
--
-- reporter_id is nullable on purpose: a signed-out visitor can see listings, so
-- a signed-out visitor can report one. When it is null the reporter was not
-- signed in, and the admin queue says so. We do not collect an email from a
-- signed-out reporter — Airbnb's flow does not ask who you are, and a free
-- contact field on an anonymous form is a spam magnet with no payoff.
--
-- ON DELETE: listing_id has no cascade. If a listing is deleted we keep the
-- report (the id still tells you which listing it was) rather than silently
-- destroying the record of an accusation. reporter_id references auth.users
-- with ON DELETE SET NULL so deleting an account does not delete the report,
-- it just anonymises it.
--
-- Safe to run twice.
--
-- PRE-FLIGHT — expect 0 rows:
--
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name = 'listing_reports';

create table if not exists public.listing_reports (
    id          uuid primary key default gen_random_uuid(),
    listing_id  uuid not null references public.listings (id),
    -- Null when the reporter was not signed in. SET NULL (not CASCADE) so
    -- deleting the reporter's account anonymises the report, never deletes it.
    reporter_id uuid references auth.users (id) on delete set null,
    -- One of the fixed reason keys in lib/listingReports.ts. Stored as its key,
    -- not the label, so the wording can change without rewriting history.
    reason      text not null,
    -- The reporter's free-text detail. Capped to 2000 chars by the route.
    details     text,
    -- Room to close a report off later without another migration. Nothing
    -- writes closed_at yet — the queue lists everything, newest first — but the
    -- column is here so a "handled" action can be added without touching money
    -- adjacent DDL under launch pressure.
    status      text not null default 'open',
    closed_at   timestamptz,
    closed_by   uuid references auth.users (id) on delete set null,
    created_at  timestamptz not null default now()
);

-- The owner tools page asks one question: what has come in, newest first.
create index if not exists listing_reports_created_idx
    on public.listing_reports (created_at desc);

create index if not exists listing_reports_listing_idx
    on public.listing_reports (listing_id);

comment on table public.listing_reports is
    'Guest/visitor reports about a listing (Airbnb-style). Read and written only via the service role in /api/listings/report and /admin/listing-reports. No anon/authenticated grants — a report names an accuser and must not be browser-readable, least of all by the host it concerns.';

-- Row-level security on, with no policy for `authenticated` and none for
-- `anon`. Nothing outside a service-role route may touch this. A per-column
-- revoke would be a no-op against a table-level grant, so — as with `disputes`
-- and `booking_host_notes` — the privacy lives in it being a separate table
-- with no browser grant at all.
alter table public.listing_reports enable row level security;

revoke all on public.listing_reports from authenticated;
revoke all on public.listing_reports from anon;

-- Read back — expect 0:
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'listing_reports' and grantee in ('anon','authenticated');
