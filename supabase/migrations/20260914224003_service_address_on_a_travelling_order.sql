-- A travelling slot booking freezes the DESTINATION ADDRESS on the order.
--
-- WHAT. A slot provider who travels to the guest (fulfilment = 'delivery') runs
-- the session at the guest's cottage. Until now the order stored only booking_id
-- / listing_id and the address was DERIVED live from the linked listing every
-- time it was shown. This freezes the address the guest picked at booking, the
-- same way price, item name, duration and the fulfilment direction are frozen —
-- so a later change to the cottage record can't rewrite where a provider was told
-- to go, and so the "type your own address" path (a guest with no booking with
-- us — scoped separately) can write into the SAME field later.
--
-- SCOPE. This column is written ONLY for the pick-your-stay path: a travelling
-- slot booked by a guest who has a booking with us, from the address of that
-- stay's cottage. It is written server-side from the trusted booking -> listing,
-- never from the browser. NULL for every other order (come-to-me, made-to-order,
-- comes-to-you, and any pre-existing row).
--
-- PRIVACY — WHO READS IT, AND WHEN.
--   * service_orders is revoked from anon and authenticated (the only table with
--     no read grant at all — 20260829030000). So NO browser can read this column
--     directly; it is reachable only through the service role.
--   * The GUEST reads their own order through the order page (service role, gated
--     by guest_id = the caller) and always sees their own destination — it is
--     their own cottage address.
--   * The PROVIDER reads orders through /api/services/orders, which releases the
--     address ONLY for a 'confirmed' order. A slot order is 'holding' until paid
--     and becomes 'confirmed' on payment (auto-capture), so confirmed == paid:
--     the provider cannot see the address before the money is captured.
-- No grant is added here on purpose — inheriting the table's no-grant is the
-- guarantee.
--
-- TEST ONLY until it ships. Additive and idempotent; safe to run twice.

alter table public.service_orders
    add column if not exists service_address text;

comment on column public.service_orders.service_address is
    'The frozen destination address for a TRAVELLING slot booking (fulfilment = '
    '''delivery''): where the provider goes. Written server-side at booking from '
    'the guest''s chosen stay (booking -> listing), never from the browser. NULL '
    'for every non-travelling order. service_orders is revoked from browser roles, '
    'so this is service-role-only: the guest sees their own via the order page; '
    'the provider sees it via /api/services/orders only once the order is '
    'confirmed (== paid for a slot), never before.';

-- PostgREST caches the schema; the new column is invisible over the API (written
-- and read under the service role) until it reloads.
notify pgrst, 'reload schema';

-- Read back (after --apply --read, or by hand on test):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name='service_orders' and column_name='service_address';
--   -- and confirm it is NOT granted to browser roles (expect no rows):
--   select grantee, privilege_type from information_schema.column_privileges
--    where table_name='service_orders' and column_name='service_address'
--      and grantee in ('anon','authenticated');
