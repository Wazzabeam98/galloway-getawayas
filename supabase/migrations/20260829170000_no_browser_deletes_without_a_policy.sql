-- No browser role may delete from a table that never meant to allow it.
--
-- WHAT WAS THERE. Supabase's default is `grant all on all tables in schema
-- public to anon, authenticated`, so DELETE and TRUNCATE were granted to both
-- browser roles on EVERY table — payments, payouts, bookings, error_log, all
-- of it. Nothing asked for them.
--
-- WHY IT WAS NOT ALREADY A DISASTER, AND WHY THAT IS THE PROBLEM.
--
-- Row level security was doing the whole job on its own. Every DELETE-capable
-- policy that exists requires auth.uid(), so `anon` matched zero rows, and the
-- money tables have no DELETE policy at all so nothing matched there either.
-- Proven from outside with the public site key: PostgREST answers
-- **204 No Content** and removes nothing.
--
-- That 204 is the shape worth removing. The grant is already in place, so the
-- day somebody adds a permissive `for all` policy to payments or bookings —
-- the most natural thing in the world to write — the delete starts working,
-- silently, with no error for anyone to notice. A grant nothing uses is a
-- loaded gun pointed at whatever policy gets written next.
--
-- WHAT THIS KEEPS, AND THE RULE FOR DECIDING.
--
-- `authenticated` keeps DELETE exactly where a deliberate DELETE-capable
-- policy already exists — that is the feature, and the policy is what scopes
-- it to the caller's own rows. Everywhere else the grant is dead weight.
--
-- The keep-list was checked against what the browser actually deletes, not
-- derived from the policies alone: quick replies, iCal feeds, message
-- templates and their listing links, calendar overrides, and the whole
-- service_* family a provider edits. Plus conversation_prefs, reviews (own,
-- unpublished), booking_guests and listing_access, which have deliberate
-- policies.
--
-- `anon` keeps nothing. Every delete policy on this database requires
-- auth.uid(), so a signed-out caller can never legitimately delete anything.
--
-- TRUNCATE goes from both roles everywhere, no exceptions. It is not subject
-- to row level security at all — no policy would save us — and it is not
-- reachable through PostgREST, which is the only thing the site key can talk
-- to. It should simply not be granted.
--
-- NOT IN HERE, THOUGH IT TURNED UP WHILE WRITING IT: components/DeleteHomebtn
-- deletes from `listings` as the browser user, and `listings` has no DELETE
-- policy. So "Delete my home" answers 204 and does nothing, and the dialog
-- refreshes as though it worked. Revoking the grant changes that from a silent
-- no-op to a silent no-op, so this migration neither fixes nor worsens it.
-- Recorded in OUTSTANDING.md; it needs a decision about what deleting a
-- listing should mean, not a grant.
--
-- Pre-flight — what is granted now:
--   select table_name, grantee, string_agg(privilege_type, ',') from
--   information_schema.table_privileges where table_schema='public'
--   and grantee in ('anon','authenticated')
--   and privilege_type in ('DELETE','TRUNCATE') group by 1,2 order by 1,2;
--
-- Safe to run twice.

-- TRUNCATE: nobody, nowhere.
revoke truncate on table public.admin_actions from anon, authenticated;
revoke truncate on table public.booking_guests from anon, authenticated;
revoke truncate on table public.bookings from anon, authenticated;
revoke truncate on table public.calendar_overrides from anon, authenticated;
revoke truncate on table public.conversation_prefs from anon, authenticated;
revoke truncate on table public.disputes from anon, authenticated;
revoke truncate on table public.error_log from anon, authenticated;
revoke truncate on table public.listing_access from anon, authenticated;
revoke truncate on table public.listing_access_codes from anon, authenticated;
revoke truncate on table public.listing_ical_feeds from anon, authenticated;
revoke truncate on table public.listings from anon, authenticated;
revoke truncate on table public.message_template_listings from anon, authenticated;
revoke truncate on table public.message_templates from anon, authenticated;
revoke truncate on table public.messages from anon, authenticated;
revoke truncate on table public.notification_preferences from anon, authenticated;
revoke truncate on table public.payments from anon, authenticated;
revoke truncate on table public.payouts from anon, authenticated;
revoke truncate on table public.profiles from anon, authenticated;
revoke truncate on table public.quick_replies from anon, authenticated;
revoke truncate on table public.rate_limit_hits from anon, authenticated;
revoke truncate on table public.reviews from anon, authenticated;
revoke truncate on table public.sent_reply_nudges from anon, authenticated;
revoke truncate on table public.sent_review_reminders from anon, authenticated;
revoke truncate on table public.sent_scheduled_messages from anon, authenticated;
revoke truncate on table public.service_areas from anon, authenticated;
revoke truncate on table public.service_enquiries from anon, authenticated;
revoke truncate on table public.service_provider_extras from anon, authenticated;
revoke truncate on table public.service_provider_prices from anon, authenticated;
revoke truncate on table public.service_provider_registrations from anon, authenticated;
revoke truncate on table public.service_provider_skills from anon, authenticated;
revoke truncate on table public.service_providers from anon, authenticated;
revoke truncate on table public.service_requests from anon, authenticated;
revoke truncate on table public.service_skills from anon, authenticated;
revoke truncate on table public.service_wanted from anon, authenticated;
revoke truncate on table public.services from anon, authenticated;
revoke truncate on table public.stripe_events from anon, authenticated;

-- DELETE from anon: nowhere. Every delete policy needs auth.uid().
revoke delete on table public.admin_actions from anon;
revoke delete on table public.booking_guests from anon;
revoke delete on table public.bookings from anon;
revoke delete on table public.calendar_overrides from anon;
revoke delete on table public.conversation_prefs from anon;
revoke delete on table public.disputes from anon;
revoke delete on table public.error_log from anon;
revoke delete on table public.listing_access from anon;
revoke delete on table public.listing_access_codes from anon;
revoke delete on table public.listing_ical_feeds from anon;
revoke delete on table public.listings from anon;
revoke delete on table public.message_template_listings from anon;
revoke delete on table public.message_templates from anon;
revoke delete on table public.messages from anon;
revoke delete on table public.notification_preferences from anon;
revoke delete on table public.payments from anon;
revoke delete on table public.payouts from anon;
revoke delete on table public.profiles from anon;
revoke delete on table public.quick_replies from anon;
revoke delete on table public.rate_limit_hits from anon;
revoke delete on table public.reviews from anon;
revoke delete on table public.sent_reply_nudges from anon;
revoke delete on table public.sent_review_reminders from anon;
revoke delete on table public.sent_scheduled_messages from anon;
revoke delete on table public.service_areas from anon;
revoke delete on table public.service_enquiries from anon;
revoke delete on table public.service_provider_extras from anon;
revoke delete on table public.service_provider_prices from anon;
revoke delete on table public.service_provider_registrations from anon;
revoke delete on table public.service_provider_skills from anon;
revoke delete on table public.service_providers from anon;
revoke delete on table public.service_requests from anon;
revoke delete on table public.service_skills from anon;
revoke delete on table public.service_wanted from anon;
revoke delete on table public.services from anon;
revoke delete on table public.stripe_events from anon;

-- DELETE from authenticated: only where no policy would ever use it.
revoke delete on table public.admin_actions from authenticated;
revoke delete on table public.bookings from authenticated;
revoke delete on table public.disputes from authenticated;
revoke delete on table public.error_log from authenticated;
revoke delete on table public.listing_access_codes from authenticated;
revoke delete on table public.listings from authenticated;
revoke delete on table public.messages from authenticated;
revoke delete on table public.notification_preferences from authenticated;
revoke delete on table public.payments from authenticated;
revoke delete on table public.payouts from authenticated;
revoke delete on table public.profiles from authenticated;
revoke delete on table public.rate_limit_hits from authenticated;
revoke delete on table public.sent_reply_nudges from authenticated;
revoke delete on table public.sent_review_reminders from authenticated;
revoke delete on table public.sent_scheduled_messages from authenticated;
revoke delete on table public.service_enquiries from authenticated;
revoke delete on table public.service_provider_skills from authenticated;
revoke delete on table public.service_requests from authenticated;
revoke delete on table public.service_skills from authenticated;
revoke delete on table public.service_wanted from authenticated;
revoke delete on table public.services from authenticated;
revoke delete on table public.stripe_events from authenticated;

-- Deliberately NOT revoked from authenticated — each has a DELETE-capable
-- policy scoping it to the caller's own rows, and the app uses it:
--   booking_guests
--   calendar_overrides
--   conversation_prefs
--   listing_access
--   listing_ical_feeds
--   message_template_listings
--   message_templates
--   quick_replies
--   reviews
--   service_areas
--   service_provider_extras
--   service_provider_prices
--   service_provider_registrations
--   service_providers

-- Read back — expect no anon rows at all, and authenticated DELETE on exactly
-- the 14 tables above:
--   select grantee, privilege_type, count(*) from information_schema.table_privileges
--    where table_schema='public' and grantee in ('anon','authenticated')
--      and privilege_type in ('DELETE','TRUNCATE') group by 1,2 order by 1,2;

-- ---------------------------------------------------------------------------
-- AND THE VIEWS, WHICH IS WHERE THE FIRST PASS OF THIS MIGRATION LEAKED
-- ---------------------------------------------------------------------------
--
-- The list above came from pg_tables. Views are not in pg_tables, so they kept
-- their default grants — and all three of these are AUTO-UPDATABLE, which
-- means a delete against the view propagates to the table underneath it.
--
-- That is not theoretical. After the revokes above were applied, a signed-in
-- user on the test project deleted their own `profiles` row through
-- `profile_private` — 204, and the row was gone. Every revoke above was still
-- in place. The view walked straight around them.
--
-- Two separate problems, and the second is the one that would have hurt:
--
--   the bypass          revoking DELETE on a table means nothing while a view
--                       over it still has the grant
--   what it allowed     deleting a profiles row directly is not how an account
--                       is closed. delete_own_account() exists, is SECURITY
--                       DEFINER, and tidies up the auth user and everything
--                       hanging off it. A bare delete leaves an orphaned auth
--                       user and every foreign key pointing at nothing.
--
-- INSERT and UPDATE are left alone: profile_private is how the account page
-- writes a phone number and an address, and service_provider_own_contacts is
-- how a provider edits their own contact details. Only the two that nothing
-- uses are taken away.
revoke delete, truncate on table public.profile_private from anon, authenticated;
revoke delete, truncate on table public.service_provider_own_contacts from anon, authenticated;
revoke delete, truncate on table public.listing_busy_nights from anon, authenticated;

-- Read back — expect nothing at all:
--   select table_name, grantee, privilege_type
--     from information_schema.table_privileges
--    where table_schema = 'public'
--      and grantee in ('anon','authenticated')
--      and privilege_type = 'TRUNCATE';
