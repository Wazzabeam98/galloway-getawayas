-- Self-serve take-down: a guest-experience provider can hide their own listing
-- and put it back, without an admin and without re-approval.
--
-- WHY A NEW COLUMN, NOT A STATUS VALUE
--
-- `status` is the admin's word on the business — draft / pending_review /
-- approved / declined / hidden — and 'hidden' is a MODERATION action only an
-- admin sets and only an admin lifts (app/api/admin/providers). Coming back from
-- it is effectively re-approval, which is exactly what a provider pausing for a
-- month must NOT need. So the pause is its own boolean, orthogonal to status: the
-- row stays `approved` throughout, and the provider flips this on and off.
--
-- BEHAVIOUR. `isLiveToGuests` gains `&& !owner_paused`, so a paused provider drops
-- out of every marketplace read (homepage, browse, against-a-stay) and can take no
-- NEW booking. It does nothing to bookings already confirmed — those are
-- commitments; they stay in the provider's diary and are honoured. Un-pausing puts
-- the listing straight back, live, with no review.
--
-- GRANTS. Deliberately NOT granted to `authenticated` and NOT added to the write
-- allow-list: the flag is read and written only by the provider editor's
-- service-role route (ownership-checked), never by the browser directly — the same
-- way cancellation_window_hours and slot_turnaround_minutes are handled. It is
-- therefore recorded in REVOKED in the select-grant-decision guard, with that
-- reason. Default false = inert for every existing row.

alter table "public"."service_providers"
    add column if not exists "owner_paused" boolean not null default false;

-- PostgREST caches the schema; harmless here (the flag is service-role only) but
-- kept for consistency with every other column add.
notify pgrst, 'reload schema';

-- Read back:
--   -- the column exists, defaulted false, and authenticated CANNOT select it:
--   select owner_paused from service_providers limit 1;             -- all false
--   select column_name from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and privilege_type='SELECT' and column_name='owner_paused';  -- no rows
