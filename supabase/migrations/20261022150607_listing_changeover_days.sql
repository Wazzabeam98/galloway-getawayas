-- listing changeover days
--
-- WHAT THIS IS FOR. Airbnb's "Restrict check-in days" and "Restrict checkout
-- days": the host ticks the weekdays guests may ARRIVE on and the weekdays
-- they may LEAVE on (a Monday/Friday changeover, as SuperControl hosts run).
-- James at Silver Birch would not publish without it (22/10/2026).
--
-- Weekdays are 0 = Sunday … 6 = Saturday, the same numbering as JavaScript's
-- getDay() and Postgres's extract(dow). lib/stayRules reads them: the guest's
-- calendar greys out a day that breaks them, and the checkout route and the
-- change-request routes refuse a stay that breaks them, before any payment.
--
-- EXISTING LISTINGS. The default is all seven days, so every listing that is
-- on the site today behaves exactly as before. NOT NULL, and a check keeps it
-- a non-empty list of 0–6, so no listing can end up with no day guests may
-- arrive or leave.
--
-- THE WRITE SIDE. Written only through /api/listings/save (service role,
-- checkListing 'can_listing' — the owner, or a co-host with listing
-- permission), which cleans both with lib/stayRules cleanWeekdays. They are
-- NOT added to authenticated's UPDATE allow-list (20260903161233). The table
-- INSERT grant covers them; the check below bounds the values whoever writes.
--
-- THE READ SIDE. Public, like min_nights: the anon listing page selects them
-- (LISTING_PAGE_COLUMNS) to grey out the calendar, so anon must hold SELECT or
-- every signed-out listing page 404s (#426). listing_private is rebuilt so the
-- owner's screens reading it with select('*') see them.
--
-- PRE-FLIGHT: not destructive. Two columns with a constant default (every
-- existing row gets all seven days), one check each, one SELECT grant, the
-- owner view re-created with the same body. Safe to run twice.

alter table public.listings add column if not exists checkin_days smallint[] not null default '{0,1,2,3,4,5,6}';
alter table public.listings add column if not exists checkout_days smallint[] not null default '{0,1,2,3,4,5,6}';

alter table public.listings drop constraint if exists listings_checkin_days_check;
alter table public.listings add constraint listings_checkin_days_check
    check (cardinality(checkin_days) between 1 and 7 and checkin_days <@ '{0,1,2,3,4,5,6}'::smallint[]);
alter table public.listings drop constraint if exists listings_checkout_days_check;
alter table public.listings add constraint listings_checkout_days_check
    check (cardinality(checkout_days) between 1 and 7 and checkout_days <@ '{0,1,2,3,4,5,6}'::smallint[]);

comment on column public.listings.checkin_days is
    'Weekdays guests may check in (0=Sun..6=Sat). Default all seven. Written via /api/listings/save only; enforced by lib/stayRules at checkout and on change requests.';
comment on column public.listings.checkout_days is
    'Weekdays guests may check out (0=Sun..6=Sat). Default all seven. Written via /api/listings/save only; enforced by lib/stayRules at checkout and on change requests.';

grant select (checkin_days, checkout_days) on public.listings to anon, authenticated;

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
--   select count(*) from public.listings where checkin_days <> '{0,1,2,3,4,5,6}' or checkout_days <> '{0,1,2,3,4,5,6}';   -- 0
--   select has_column_privilege('anon', 'public.listings', 'checkin_days', 'select') and has_column_privilege('anon', 'public.listings', 'checkout_days', 'select'); -- true
--   select has_column_privilege('authenticated', 'public.listings', 'checkin_days', 'update');                                -- false
--   select count(*) from information_schema.columns where table_name = 'listing_private' and column_name in ('checkin_days', 'checkout_days'); -- 2
