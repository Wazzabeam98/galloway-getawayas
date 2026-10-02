-- A private slot booking carries how many people are coming.
--
-- A private session (a flat-priced slot item) is bought once and closes the time
-- to everyone else, but a whole cottage can be behind that one booking. Until now
-- nothing recorded the head count: the guest was never asked, and the provider
-- saw only the cottage's party size on the order (a proxy, and only sometimes the
-- same number). A yoga teacher booked by a cottage of six could turn up with one
-- mat. This adds the count the guest is now asked for.
--
-- attendees is the number of people at a PRIVATE session, 1..cap, where the cap
-- is the provider's declared capacity if it has one, else the cottage's guest
-- count (a traveller declares no capacity). NULL for a per-person booking (there
-- the quantity already IS the head count) and for every pre-existing row. It does
-- NOT touch price: a private session is one flat price whatever the head count.
--
-- service_orders is written by the service role (the claim) and revoked from the
-- browser roles, so the column needs no grant. TEST ONLY until it ships.

alter table public.service_orders
    add column if not exists attendees integer
        check (attendees is null or attendees >= 1);

comment on column public.service_orders.attendees is
    'Head count at a PRIVATE (flat) slot session, asked of the guest and capped at '
    'the provider''s capacity or the cottage''s guest count. NULL for per-person '
    'bookings (quantity is the count there) and pre-existing rows. Never affects price.';

-- PostgREST caches the schema; the new column is invisible over the API (the
-- claim writes it under the service role) until it reloads.
notify pgrst, 'reload schema';

-- Read back (after --apply --read, or by hand on test):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name='service_orders' and column_name='attendees';
