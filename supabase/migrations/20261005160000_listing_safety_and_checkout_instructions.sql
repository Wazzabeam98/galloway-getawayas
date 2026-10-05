-- Airbnb's guest-safety disclosures and checkout instructions, for the listing
-- editor's new "Your space" and "Arrival" tabs.
--
-- Two new PUBLIC columns on listings, both the same shape — a list of chosen
-- items, each with an optional note:
--   safety_disclosures     jsonb  — [{ key, note }]: security cameras, noise
--                                   monitors, nearby water, heights, animals…
--                                   (lib/listingDisclosures.ts holds the keys).
--                                   Shown under "Safety & property" on the
--                                   listing page. The smoke and CO alarms stay
--                                   in `amenities`, where search reads them.
--   checkout_instructions  jsonb  — [{ key, note }]: gather towels, rubbish,
--                                   turn things off, lock up, return keys,
--                                   anything else. Shown under House rules as
--                                   "Before you leave".
--
-- Both are host-written but ONLY through /api/listings/save (service role),
-- never a direct browser UPDATE — so they are granted SELECT (public content on
-- the listing page) and NOT UPDATE, and are classified PLATFORM_ONLY in
-- tests/listings-writable-columns-guard.test.ts with that reason, exactly like
-- sleeping_arrangements / neighbourhood before them.

alter table "public"."listings"
    add column if not exists "safety_disclosures" jsonb not null default '[]'::jsonb;

alter table "public"."listings"
    add column if not exists "checkout_instructions" jsonb not null default '[]'::jsonb;

-- Arrays only, and bounded — a paste cannot run to unbounded length. The item
-- rules themselves (known keys, a camera needs a note) live in
-- lib/listingDisclosures.ts, checked by both the editor and the save route.
alter table "public"."listings"
    drop constraint if exists "listings_safety_disclosures_shape";
alter table "public"."listings"
    add constraint "listings_safety_disclosures_shape"
    check (jsonb_typeof(safety_disclosures) = 'array' and pg_column_size(safety_disclosures) <= 8192);

alter table "public"."listings"
    drop constraint if exists "listings_checkout_instructions_shape";
alter table "public"."listings"
    add constraint "listings_checkout_instructions_shape"
    check (jsonb_typeof(checkout_instructions) = 'array' and pg_column_size(checkout_instructions) <= 8192);

-- Public content: both browser roles read them on the listing page. Additive to
-- the existing column allow-lists — the two columns join the list, nothing
-- else changes.
grant select ("safety_disclosures", "checkout_instructions") on "public"."listings" to "anon";
grant select ("safety_disclosures", "checkout_instructions") on "public"."listings" to "authenticated";

-- Deliberately NOT granted UPDATE to either browser role.

-- listing_private is `select l.*`, frozen to the columns that existed when it
-- was last created — recreate it (same body) so l.* picks the new ones up, and
-- re-apply the read-only grant (the browser-views write trap, 20260903011803).
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
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_name='listings' and column_name in ('safety_disclosures','checkout_instructions');
--   -- expected: both jsonb, NOT NULL, default '[]'
--   select grantee, privilege_type from information_schema.role_column_grants
--    where table_name='listings' and column_name in ('safety_disclosures','checkout_instructions')
--    order by 1, 2;
--   -- expected: anon SELECT ×2, authenticated SELECT ×2, no UPDATE
