-- Provider fulfilment direction + a private collection address, split into fields.
--
-- WHY
--
-- A guest experience is one of two things regardless of its booking engine
-- (`shape`): the provider goes to the guest, or the guest comes to the provider.
-- `shape` conflated the two (comes_to_you baked in "travels"; food_order assumed
-- delivery; massage assumed the guest comes). This adds that direction as its OWN
-- axis so a food-to-order provider can deliver, offer collection, or both — and
-- massage can adopt the same field next, without touching `shape`.
--
--   fulfilment           'delivery' | 'collection' | 'both'
--   collection_street    where a guest collects — the street line. PRIVATE.
--   collection_town      the town. Its PUBLIC expression is `based_line`, which
--                        the wizard writes from it (town alone — everything is in
--                        Dumfries & Galloway, so the region adds nothing). The
--                        column itself stays private so the owner can edit it.
--   collection_postcode  the postcode. PRIVATE.
--
-- WHY THREE FIELDS, NOT ONE BLOB. A single free-text address can't be split back
-- into its town reliably, so we could never tell whether to say "based in
-- Dumfries" or "based in Kirkcudbright". Separate fields — exactly the split the
-- cottage side already makes (listings.street_address / postcode private, the
-- town inside the public `location`).
--
-- PRIVACY (mirrors listings / listing_private exactly)
--
-- service_providers already scopes authenticated SELECT to a column allow-list
-- (20260828202340), so a new column defaults to HIDDEN unless it is granted. We
-- rely on that:
--   - `fulfilment` is granted SELECT to authenticated (the sign-up wizard reads
--     its own record back; the public listing reads it via the service role).
--   - The three collection_* columns are NEVER granted SELECT to anon or
--     authenticated. A browser cannot read them. The OWNER reads their own back —
--     to edit them — only through `provider_private`, a SECURITY DEFINER view
--     (owner-row only), the same shape as listing_private / profile_private. A
--     confirmed guest sees them only via a service-role reader on the order page.
--     The public town lives in `based_line` (already a granted column), never in
--     these.
-- All four new columns need INSERT/UPDATE granted to authenticated so the
-- provider can write them directly on their own row (RLS already limits which
-- row).
--
-- HELD, TEST ONLY. This migration has never shipped to production. It began as a
-- single `collection_address text` column (applied to TEST only) and was revised
-- here to the field split before any prod deploy — so it drops that interim
-- column and its dependent view on re-apply, and there is nothing to unwind on
-- prod.

-- The interim single-column shape and its view, dropped so the re-apply is clean
-- on TEST. `if exists` so a fresh project (prod, when it lands) skips them.
drop view if exists "public"."provider_private";
alter table "public"."service_providers"
    drop column if exists "collection_address";

alter table "public"."service_providers"
    add column if not exists "fulfilment" text
        check ("fulfilment" is null or "fulfilment" in ('delivery', 'collection', 'both')),
    add column if not exists "collection_street" text,
    add column if not exists "collection_town" text,
    add column if not exists "collection_postcode" text;

-- Readable by the signed-in owner (restores the wizard). The collection_*
-- columns are deliberately absent — they stay hidden under the allow-list.
grant select ("fulfilment") on "public"."service_providers" to "authenticated";

-- Writable by the provider on their own row (RLS-scoped). The collection_*
-- columns are write-yes / read-no for the browser: written here, read back only
-- via the view.
grant insert ("fulfilment", "collection_street", "collection_town", "collection_postcode"),
      update ("fulfilment", "collection_street", "collection_town", "collection_postcode")
    on "public"."service_providers" to "authenticated";

-- The owner's private read of their own collection address, so a returning
-- provider can edit it while it stays revoked on the table. SECURITY DEFINER (the
-- default for a view): it runs as its owner and returns the columns revoked from
-- the caller; the WHERE is the whole of the protection — own row only, and
-- auth.uid() is null when signed out so it matches nothing.
create or replace view "public"."provider_private" as
    select p."id", p."owner_id",
           p."collection_street", p."collection_town", p."collection_postcode"
      from "public"."service_providers" p
     where p."owner_id" = auth.uid();

-- Read, not write (the browser-views trap).
revoke all on "public"."provider_private" from "anon", "authenticated";
grant select on "public"."provider_private" to "authenticated";
revoke insert, update, delete, truncate, references, trigger
    on "public"."provider_private" from "authenticated", "anon";

-- PostgREST caches the schema/grants; the new columns, grants and view are
-- invisible over the API until it reloads.
notify pgrst, 'reload schema';

-- Read back:
--   -- authenticated CAN select fulfilment, CANNOT select any collection_* column:
--   select column_name from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and privilege_type='SELECT'
--      and column_name in ('fulfilment','collection_street','collection_town','collection_postcode');
--   -- the owner reads their own address only, via the view:
--   select collection_street, collection_town, collection_postcode from provider_private;
