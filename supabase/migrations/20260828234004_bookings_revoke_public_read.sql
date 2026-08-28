-- Close bookings to strangers, now that the calendar reads the view.
--
-- STEP THREE OF THREE. Run this ONLY after the code reading
-- listing_busy_nights is live — before that, dropping the policy empties the
-- availability calendar on every listing page and the busy markers on the
-- home page.
--
-- Pre-flight:
--   select policyname from pg_policies where tablename = 'bookings' and cmd = 'SELECT';
--
-- Safe to run twice.

drop policy if exists "Public can view confirmed booking dates for calendar export"
    on "public"."bookings";

-- Belt and braces. With no policy left for it, anon would read nothing anyway;
-- revoking the grant means a policy added later cannot quietly re-open the
-- table without somebody also granting the columns.
revoke select on table "public"."bookings" from "anon";

-- Read back:
--   select count(*) from pg_policies
--    where tablename = 'bookings' and cmd = 'SELECT';   -- expect 2
--   select count(*) from information_schema.column_privileges
--    where table_name = 'bookings' and grantee = 'anon'
--      and privilege_type = 'SELECT';                   -- expect 0
