-- Provider fulfilment direction + a private collection address.
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
--   fulfilment          'delivery' | 'collection' | 'both'
--   collection_address  where a guest collects — PRIVATE, released only on a
--                       confirmed (paid) order, the same rule as a cottage's
--                       street address.
--
-- PRIVACY (mirrors listings / listing_private exactly)
--
-- service_providers already scopes authenticated SELECT to a column allow-list
-- (20260828202340), so a new column defaults to HIDDEN unless it is granted. We
-- rely on that:
--   - `fulfilment` is granted SELECT to authenticated (the sign-up wizard reads
--     its own record back; the public listing reads it via the service role).
--   - `collection_address` is NEVER granted SELECT to anon or authenticated. A
--     browser cannot read it. The OWNER reads their own back — to edit it — only
--     through `provider_private`, a SECURITY DEFINER view (owner-row only), the
--     same shape as listing_private / profile_private. A confirmed guest sees it
--     only via a service-role reader on the order page. It is never on the public
--     listing and never in a client-readable column.
-- Both new columns need INSERT/UPDATE granted to authenticated so the provider
-- can write them directly on their own row (RLS already limits which row).

alter table "public"."service_providers"
    add column if not exists "fulfilment" text
        check ("fulfilment" is null or "fulfilment" in ('delivery', 'collection', 'both')),
    add column if not exists "collection_address" text;

-- Readable by the signed-in owner (restores the wizard). collection_address is
-- deliberately absent — it stays hidden under the allow-list.
grant select ("fulfilment") on "public"."service_providers" to "authenticated";

-- Writable by the provider on their own row (RLS-scoped). collection_address is
-- write-yes / read-no for the browser: written here, read back only via the view.
grant insert ("fulfilment"), update ("fulfilment") on "public"."service_providers" to "authenticated";
grant insert ("collection_address"), update ("collection_address") on "public"."service_providers" to "authenticated";

-- The owner's private read of their own collection address, so a returning
-- provider can edit it while it stays revoked on the table. SECURITY DEFINER (the
-- default for a view): it runs as its owner and returns the column revoked from
-- the caller; the WHERE is the whole of the protection — own row only, and
-- auth.uid() is null when signed out so it matches nothing.
create or replace view "public"."provider_private" as
    select p."id", p."owner_id", p."collection_address"
      from "public"."service_providers" p
     where p."owner_id" = auth.uid();

-- Read, not write (the browser-views trap).
revoke all on "public"."provider_private" from "anon", "authenticated";
grant select on "public"."provider_private" to "authenticated";
revoke insert, update, delete, truncate, references, trigger
    on "public"."provider_private" from "authenticated", "anon";

-- PostgREST caches the schema/grants; the new column, grants and view are
-- invisible over the API until it reloads.
notify pgrst, 'reload schema';

-- Read back:
--   -- authenticated CAN select fulfilment, CANNOT select collection_address:
--   select column_name from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and privilege_type='SELECT' and column_name in ('fulfilment','collection_address');
--   -- the owner reads their own address only, via the view:
--   select collection_address from provider_private;
