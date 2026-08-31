-- Moving the day on an accepted job is a REQUEST, not a fait accompli.
--
-- The first cut of the cancel/amend work let a tradesman write preferred_date
-- directly. That was wrong for exactly the reason he cannot accept on the
-- host's behalf: the host is the one who knows whether a guest is in the
-- cottage that day. An accepted job is close to a booking, and a booking's
-- dates do not move because one side decided so.
--
-- So a new day is PROPOSED and held here until the host accepts it. Until they
-- do, the agreed day — preferred_date — stands untouched. Accepting copies the
-- proposal onto preferred_date (and the window with it) and clears these;
-- declining just clears them. Same shape as accepting the original enquiry.
--
-- Only the tradesman proposes a move, so there is no proposed_by: a host who
-- wants a different day cancels and re-asks, which is a fresh enquiry with its
-- own accept. Written under the service role like every other date on this row.
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_enquiries"
    add column if not exists "proposed_date"        date;
alter table "public"."service_enquiries"
    add column if not exists "proposed_window_from" time;
alter table "public"."service_enquiries"
    add column if not exists "proposed_window_to"   time;
alter table "public"."service_enquiries"
    add column if not exists "proposed_at"          timestamptz;
