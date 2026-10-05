-- widen listing_reports for experience and trade targets
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- Until now a report could only point at a cottage listing (listing_id NOT NULL,
-- FK to listings). "Report this listing" now also sits on guest-experience pages
-- and trade profiles, which are rows in service_providers, not listings. Without
-- this, the report insert for an experience/trade would fail the NOT NULL (no
-- listing_id) and there would be nowhere to record what kind of thing was
-- reported — the browser would report success while nothing was saved, the same
-- silent-insert-failure this project has hit before.
--
-- The target is now carried by target_type ('listing' | 'experience' | 'trade')
-- and target_id. listing_id stays, nullable, still populated for a listing report
-- (back-compat with existing rows and the admin "look at the listing" link);
-- experiences and trades are both service_providers, told apart by target_type.
--
-- Not destructive: it only drops a NOT NULL, adds two nullable columns, backfills
-- existing rows and adds a permissive CHECK + an index. No data is removed and
-- nothing that was valid before becomes invalid, so it needs no --destructive and
-- no pre-flight count. The table is RLS-walled with no browser grants, so the new
-- columns need no grant/revoke and are not governed by the column-bucket guards.

alter table public.listing_reports alter column listing_id drop not null;

alter table public.listing_reports add column if not exists target_type text;
alter table public.listing_reports add column if not exists target_id uuid;

-- Existing rows are all listing reports.
update public.listing_reports
   set target_type = 'listing', target_id = listing_id
 where target_type is null and listing_id is not null;

-- Only the three kinds we know, and null is tolerated (older rows, before a
-- backfill runs) so the constraint can never refuse an insert it shouldn't.
alter table public.listing_reports drop constraint if exists listing_reports_target_type_chk;
alter table public.listing_reports
  add constraint listing_reports_target_type_chk
  check (target_type is null or target_type in ('listing', 'experience', 'trade'));

create index if not exists listing_reports_target_idx
  on public.listing_reports (target_type, target_id);
