-- bookings.listing_id must REFUSE a listing delete, not cascade it.
--
-- THE LANDMINE THIS DEFUSES
--
-- The constraint was ON DELETE CASCADE. Deleting a listing would delete every
-- booking on it — confirmed, paid, already paid out — and with them the only
-- record of money that moved. It is dormant today: there is no delete button,
-- no DELETE policy on listings for either browser role, and no code path that
-- deletes a listing. So nothing can trigger it now.
--
-- But dormant is not safe. The day someone adds a "delete listing" feature, or
-- runs one DELETE in the SQL console to tidy up, the financial history goes
-- with the row and there is no warning. RESTRICT turns that into a loud error
-- ("update or delete on listings violates foreign key") instead of silent data
-- loss — which is exactly the right direction: a listing with bookings against
-- it should not be deletable at all. Hiding (status = 'hidden') already covers
-- taking a listing off the site without touching its bookings.
--
-- Pre-flight: none. Re-pointing a foreign key rewrites no rows and reads none;
-- it only changes what happens on a future delete. Existing bookings are
-- untouched.
--
-- Reversible: swap RESTRICT back to CASCADE. Nothing depends on this in code,
-- so it needs no coordinated deploy — but it still goes to production before
-- it merges, like every migration here.

alter table "public"."bookings"
    drop constraint if exists "bookings_listing_id_fkey";

alter table "public"."bookings"
    add constraint "bookings_listing_id_fkey"
    foreign key ("listing_id") references "public"."listings" ("id")
    on delete restrict;

-- Read back (confdeltype 'r' = RESTRICT, was 'c' = CASCADE):
--   select confdeltype from pg_constraint
--    where conrelid = 'public.bookings'::regclass
--      and conname = 'bookings_listing_id_fkey';
