-- STEP 1 OF 2. Run this one now, on both projects.
--
-- One typed home for the end of the check-in window, replacing the text
-- column `checkin_end`.
--
-- There were two sets of columns doing this job. The typed pair,
-- check_in_time and check_out_time, written by Account settings; and a text
-- trio, checkin_start / checkin_end / checkout_time, written by the listing
-- editor. Nothing reconciled them, and the two editors could not see each
-- other's values.
--
-- The typed pair wins, and not only because of the types:
-- send_due_scheduled_messages() already reads both to decide when a scheduled
-- message goes out. A "12 hours before check-out" template is counted back
-- from check_out_time. The text columns feed nothing but a line in the
-- messages pane.
--
-- Nullable, and no default. Null means there is no stated end to the check-in
-- window, which is the honest state today: checkin_end is '' on every row in
-- both projects.

alter table public.listings
    add column if not exists "check_in_end_time" time without time zone;

comment on column public.listings.check_in_end_time is
    'Latest a guest may check in. Null means no stated end to the window. '
    'Companion to check_in_time and check_out_time.';
