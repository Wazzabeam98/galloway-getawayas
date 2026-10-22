-- listing pool access and setting
--
-- WHAT THIS IS FOR. "Pool" is an amenity hosts tick (the card badge, the Pool
-- chip and the search filter read the amenity, exactly like Hot tub and
-- Sauna). Like Airbnb, once it is ticked the host says whether the pool is
-- PRIVATE or SHARED and INDOOR or OUTDOOR, and the listing page shows it as one
-- line ("Private outdoor pool"). Those two answers are these columns. Null
-- means the host has not said; the page then just says "Pool".
--
-- THE WRITE SIDE. Written only through /api/listings/save (service role,
-- checkListing 'can_listing'), which cleans both with lib/poolDetails and
-- clears them when Pool is not ticked. They are NOT added to authenticated's
-- UPDATE allow-list (20260903161233). The table-level INSERT grant does cover
-- them, which is harmless: it is the host's own description of their own
-- place, and the check constraints below bound the values whoever writes.
--
-- THE READ SIDE. Public, like amenities: the anon listing page selects them
-- (LISTING_PAGE_COLUMNS), so anon must hold SELECT or every signed-out listing
-- page 404s (#426). listing_private is rebuilt so the owner's editor, which
-- reads it with select('*'), sees them — a view's l.* is fixed when the view
-- is created and does not pick new columns up by itself.
--
-- PRE-FLIGHT: not destructive. Two nullable columns (every existing listing
-- null — nothing is ticked for anyone), two checks, one SELECT grant, the
-- owner view re-created with the same body. Safe to run twice.

alter table public.listings add column if not exists pool_access text;
alter table public.listings add column if not exists pool_setting text;

alter table public.listings drop constraint if exists listings_pool_access_check;
alter table public.listings add constraint listings_pool_access_check
    check (pool_access is null or pool_access in ('private', 'shared'));
alter table public.listings drop constraint if exists listings_pool_setting_check;
alter table public.listings add constraint listings_pool_setting_check
    check (pool_setting is null or pool_setting in ('indoor', 'outdoor'));

comment on column public.listings.pool_access is
    'Pool: private (guests only) or shared. Null = not said. Written via /api/listings/save only; cleared when the Pool amenity is not ticked.';
comment on column public.listings.pool_setting is
    'Pool: indoor or outdoor. Null = not said. Written via /api/listings/save only; cleared when the Pool amenity is not ticked.';

grant select (pool_access, pool_setting) on public.listings to anon, authenticated;

create or replace view "public"."listing_private" as
    select l.*
      from "public"."listings" l
     where l."host_id" = auth.uid()
        or exists (
            select 1 from "public"."listing_access" la
             where la."listing_id" = l."id"
               and la."user_id" = auth.uid()
               and la."status" = 'active'
        );

revoke all on "public"."listing_private" from "anon", "authenticated";
grant select on "public"."listing_private" to "authenticated";
revoke insert, update, delete, truncate, references, trigger
    on "public"."listing_private" from "authenticated", "anon";

notify pgrst, 'reload schema';

-- Read back:
--   select column_name, data_type, is_nullable from information_schema.columns where table_name = 'listings' and column_name in ('pool_access', 'pool_setting');   -- text | YES, twice
--   select count(*) from public.listings where pool_access is not null or pool_setting is not null;                                                              -- 0
--   select has_column_privilege('anon', 'public.listings', 'pool_access', 'select') and has_column_privilege('anon', 'public.listings', 'pool_setting', 'select'); -- true
--   select has_column_privilege('authenticated', 'public.listings', 'pool_access', 'update');                                                                     -- false
--   select count(*) from information_schema.columns where table_name = 'listing_private' and column_name in ('pool_access', 'pool_setting');                      -- 2
