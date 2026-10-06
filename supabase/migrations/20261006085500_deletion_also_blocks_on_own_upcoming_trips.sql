-- Deletion also blocks on the person's OWN upcoming trips
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- 20261006081500 made account deletion (admin_anonymise_account) refuse for the
-- same reasons a DEACTIVATION refuses — account_deactivation_blockers: a listing
-- with other people's live reservations, an experience with live orders, a trade
-- with open enquiries, and the person's own stay already in progress. That set
-- deliberately does NOT include the person's own strictly-FUTURE trips, because
-- deactivation CANCELS and refunds those under the policy rather than blocking.
--
-- Deletion is different: it is permanent and does NOT cancel-and-refund. So with
-- only the deactivation set, a guest with a paid, upcoming stay could erase
-- themselves and leave that stay standing behind a "Deleted user" the host can
-- no longer reach — the guest's money sitting against an account nobody owns.
-- Airbnb refuses a deletion while you have an upcoming reservation for exactly
-- this reason.
--
-- THE FIX, WITHOUT BREAKING DEACTIVATION. account_deactivation_blockers stays
-- exactly as it is (deactivation still auto-cancels own future trips, so adding
-- them there would wrongly block the very thing it means to cancel). Instead this
-- introduces account_deletion_blockers(uid) = the deactivation set UNION the
-- person's own upcoming trips, and points the DELETE guard and the DELETE route's
-- pre-check at it. One function again, so the friendly list the account page
-- shows and the hard guard the RPC enforces can never drift apart.
--
-- The own-trip row carries the booking id as entity_id, so the account page can
-- link straight to /trips/<id>, where the guest cancels the stay (and is refunded
-- under the policy) before trying again.
--
-- NOT DESTRUCTIVE on the schema: a new function, and a CREATE OR REPLACE of the
-- erasure function with its grants re-asserted. It loses no rows or columns, so
-- it needs --apply but never --destructive.

-- 1. The deletion blocker set --------------------------------------------
-- Everything that blocks a deactivation, PLUS the person's own upcoming trips.
-- SECURITY DEFINER, owned by postgres, so the definer call below resolves on
-- ownership exactly as the deactivation worker already calls the blocker set.
-- Server-only (service_role): the delete route calls it with the admin client,
-- the same way it reads the deactivation blockers. There is no browser caller.
create or replace function public.account_deletion_blockers(target uuid)
    returns table (kind text, entity_id uuid, entity_name text, detail text)
    language sql
    stable
    security definer
    set search_path to 'public'
as $$
    -- Everything that blocks a deactivation: other people relying on this
    -- account, and the person's own stay already in progress.
    select * from public.account_deactivation_blockers(target)

    union all

    -- The person's own UPCOMING trips (as guest): a pending/confirmed stay whose
    -- check-in is strictly in the future. (A stay that has already started is the
    -- deactivation set's 'stay_in_progress' row, so it is not repeated here.)
    -- Deletion blocks on these rather than cancelling them, so a paid stay is
    -- never left behind an erased guest.
    select 'own_trip'::text,
           b.id,
           coalesce(nullif(l.title, ''), 'your stay'),
           'check-in ' || to_char(b.check_in, 'DD/MM/YYYY')
    from public.bookings b
    left join public.listings l on l.id = b.listing_id
    where b.guest_id = target
      and b.status in ('pending', 'confirmed')
      and b.check_in > current_date;
$$;

alter function public.account_deletion_blockers(uuid) owner to postgres;
revoke all on function public.account_deletion_blockers(uuid) from public;
-- Server-only, like account_deactivation_blockers(uuid): SECURITY DEFINER taking
-- a caller-supplied id, so it is NOT granted to the browser roles. The delete
-- route reads it with the service key.
grant execute on function public.account_deletion_blockers(uuid) to service_role;

-- 2. Point the erasure guard at the deletion set -------------------------
-- Identical to 20261006081500 except the guard now counts
-- account_deletion_blockers(uid) instead of account_deactivation_blockers(uid),
-- so deletion refuses on the person's own upcoming trips too. Everything else in
-- the function is byte-for-byte unchanged.
create or replace function public.admin_anonymise_account(target uuid)
    returns void
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  uid uuid := target;
  blocking int;
  old_email text;
begin
  if uid is null then
    raise exception 'No account given to anonymise.';
  end if;

  if not exists (select 1 from auth.users where id = uid) then
    raise exception 'This account no longer exists.';
  end if;

  -- Keep the login so we can scrub the lead tables that are keyed by email, not
  -- by user id (they predate the account). Captured before anything is nulled.
  select email into old_email from auth.users where id = uid;

  -- Refuse while anyone else is relying on this account OR the person has their
  -- own upcoming trip — the DELETION blocker set: everything that blocks a
  -- deactivation (a listing with other people's live reservations, an experience
  -- with live orders, a trade with open enquiries, the person's own stay in
  -- progress) PLUS the person's own future trips. Unlike deactivation, deletion
  -- does not cancel-and-refund those trips, so a paid stay is never left behind
  -- an erased guest. Raised BEFORE any scrub, so a blocked erasure touches
  -- nothing.
  select count(*) into blocking from public.account_deletion_blockers(uid);

  if blocking > 0 then
    raise exception
      'This account still has % listing(s), experience(s), enquiry(ies) or upcoming trip(s) to deal with before it can be closed.',
      blocking;
  end if;

  -- =====================================================================
  -- THE PERSON THEMSELVES
  -- =====================================================================

  -- profiles: null/scramble every personal field, keep the row (and its
  -- financial/audit links). full_name carries a readable tombstone so lists that
  -- render a name show "Deleted user" rather than a blank. stripe_account_id is
  -- deliberately kept: a refund on a PAST booking can still claw back from a
  -- host after closure, and the reversal needs their connected account.
  update public.profiles set
    full_name = 'Deleted user',
    preferred_name = null,
    show_full_name = false,
    email = 'deleted+' || uid::text || '@invalid.example',
    phone = null,
    residential_address = null,
    host_bio = null,
    trading_name = null,
    welcome_message = null,
    welcome_message_enabled = false,
    avatar_url = null,
    anonymised_at = now()
  where id = uid;

  -- =====================================================================
  -- EXPERIENCE PROVIDER / TRADE (service_providers subtree)
  -- =====================================================================

  -- service_providers: scrub business/contact/address, the venue location, the
  -- photo paths, and every free-text/JSON field the person wrote. Three columns
  -- are NOT NULL, so they reset to their empty sentinel rather than null
  -- (description '', photos '{}', declarations '{}') — nulling them would abort.
  update public.service_providers set
    business_name = 'Removed provider',
    provider_name = null,
    contact_email = null,
    contact_phone = null,
    based_line = null,
    collection_street = null,
    collection_town = null,
    collection_postcode = null,
    description = '',
    guest_details = null,
    dietary_note = null,
    declarations = '{}'::jsonb,
    photos = '{}'::text[],
    headshot = null,
    logo = null,
    venue_lat = null,
    venue_lng = null,
    custom_label = null,
    stripe_product_description = null
  where owner_id = uid;

  -- Trade registration numbers (gas/oil scheme IDs) are identifying, and the
  -- number column is constrained non-empty, so the row is deleted rather than
  -- blanked. The provider row itself survives (anonymised) for its order links.
  begin
    delete from public.service_provider_registrations
    where provider_id in (select id from public.service_providers where owner_id = uid);
  exception when undefined_table then null; end;

  -- Third-party calendar feed URLs this provider imported.
  begin
    delete from public.provider_ical_feeds
    where provider_id in (select id from public.service_providers where owner_id = uid);
  exception when undefined_table then null; end;

  -- =====================================================================
  -- HOST (listings subtree)
  -- =====================================================================

  -- Unpublish anything this user hosts before the app removes their images, so
  -- no listing is left publicly reachable with its photos (and its host) gone.
  update public.listings set status = 'hidden'
  where host_id = uid and status in ('published', 'pending_review');

  -- Arrival secrets and location: wifi name/password, directions, parking,
  -- what3words. Per-listing for every listing this user hosts.
  begin
    update public.listing_arrival set
      arrival_directions = null,
      parking_info = null,
      wifi_name = null,
      wifi_password = null,
      what3words = null
    where listing_id in (select id from public.listings where host_id = uid);
  exception when undefined_table or undefined_column then null; end;

  -- Door codes: per-listing and per-stay.
  begin
    delete from public.listing_access_codes
    where listing_id in (select id from public.listings where host_id = uid);
  exception when undefined_table then null; end;
  begin
    delete from public.booking_access_codes
    where booking_id in (select id from public.bookings where host_id = uid);
  exception when undefined_table then null; end;

  -- Third-party calendar feed URLs imported into this host's listings.
  begin
    delete from public.listing_ical_feeds
    where listing_id in (select id from public.listings where host_id = uid);
  exception when undefined_table then null; end;

  -- The host's private notes about guests (free text about third parties).
  begin
    delete from public.booking_host_notes where created_by = uid;
  exception when undefined_table then null; end;
  begin
    delete from public.order_host_notes where created_by = uid;
  exception when undefined_table then null; end;

  -- Co-host roster: invites this host created (hold a co-host's email), and any
  -- row where this user is themselves the co-host.
  begin
    delete from public.listing_access
    where user_id = uid
       or listing_id in (select id from public.listings where host_id = uid);
  exception when undefined_table then null; end;

  -- =====================================================================
  -- GUEST / SHARED
  -- =====================================================================

  -- The person's own sent messages. The thread stays so the other party keeps
  -- their own words; only this person's text is removed.
  update public.messages set body = '[message removed]' where sender_id = uid;

  -- Experience/service orders this person placed as a guest: strip the guest's
  -- identity and the health data (allergies), keep the financial row for the
  -- provider's and HMRC's records.
  begin
    update public.service_orders set
      guest_name = null,
      guest_phone = null,
      guest_email = null,
      note = null,
      allergy = null,
      service_address = null
    where guest_id = uid;
  exception when undefined_column then null; end;

  -- Co-guests this person invited, and their own co-guest rows. email is NOT
  -- NULL, so it resets to '' rather than null.
  begin
    update public.booking_guests set name = null, email = ''
    where user_id = uid or invited_by = uid;
  exception when undefined_table then null; end;

  -- Saved postal (delivery) addresses — nothing requires keeping these.
  begin
    delete from public.guest_delivery_addresses where guest_id = uid;
  exception when undefined_table then null; end;

  -- Trade enquiries: host side (this user requested a trade) carries their name,
  -- phone, email and free-text notes; provider side carries the provider's reply
  -- and contact. Scrub whichever side belongs to this user; the row survives for
  -- the other party.
  begin
    update public.service_enquiries set
      host_name = '', host_phone = '', host_email = '',
      access_note = '', when_note = '', summary = '[removed]'
    where host_id = uid;
  exception when undefined_table or undefined_column then null; end;
  begin
    update public.service_enquiries set
      provider_phone = null, provider_email = null, provider_reply = null
    where provider_id in (select id from public.service_providers where owner_id = uid);
  exception when undefined_table or undefined_column then null; end;

  -- Host "looking for a trade" posts and service requests — the person's own
  -- leads, with contact details; no retention need.
  begin
    delete from public.service_wanted where host_id = uid;
  exception when undefined_table then null; end;
  begin
    delete from public.service_requests where host_id = uid;
  exception when undefined_table then null; end;

  -- Abuse reports this user filed: drop the reporter link and their free-text
  -- accusation, keep the (now anonymous) report so moderation history survives.
  begin
    update public.listing_reports set reporter_id = null, details = '[reporter account closed]'
    where reporter_id = uid;
  exception when undefined_table or undefined_column then null; end;

  -- Error log: device fingerprint and the user link.
  begin
    update public.error_log set user_agent = null, user_id = null where user_id = uid;
  exception when undefined_table or undefined_column then null; end;

  -- Personal preferences and saved snippets (the person's own text / settings).
  begin delete from public.notification_preferences where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.conversation_prefs where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.quick_replies where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.message_templates where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.arrival_nudge_prefs where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.sent_reply_nudges where user_id = uid; exception when undefined_table then null; end;

  -- Lead-capture tables that predate the account and are keyed by email/IP, not
  -- by user id. Matched on the login we captured above.
  if old_email is not null then
    begin
      delete from public.interest_registrations where lower(email) = lower(old_email);
    exception when undefined_table then null; end;
    begin
      delete from public.service_applications where lower(email) = lower(old_email);
    exception when undefined_table then null; end;
    begin
      delete from public.rate_limit_hits where key = old_email or key = lower(old_email);
    exception when undefined_table then null; end;
  end if;

  -- =====================================================================
  -- AUTH IDENTITY — make sign-in impossible and strip all personal data
  -- =====================================================================

  update auth.users set
    email = 'deleted+' || uid::text || '@invalid.example',
    phone = null,
    raw_user_meta_data = '{}'::jsonb,
    raw_app_meta_data = jsonb_build_object('provider', 'deleted', 'providers', '[]'::jsonb),
    encrypted_password = null,
    confirmation_token = '',
    recovery_token = '',
    email_change = '',
    email_change_token_new = '',
    email_change_token_current = '',
    phone_change = '',
    phone_change_token = '',
    reauthentication_token = '',
    banned_until = now() + interval '100 years'
  where id = uid;

  -- Revoke every live credential and sign-in route. Wrapped so a GoTrue schema
  -- variant missing one of these tables does not abort the erasure.
  begin delete from auth.sessions where user_id = uid; exception when undefined_table then null; end;
  begin delete from auth.refresh_tokens where user_id::text = uid::text; exception when undefined_table then null; end;
  begin delete from auth.identities where user_id = uid; exception when undefined_table then null; end;
  begin delete from auth.mfa_factors where user_id = uid; exception when undefined_table then null; end;
  begin delete from auth.one_time_tokens where user_id = uid; exception when undefined_table then null; end;
  begin delete from auth.flow_state where user_id = uid; exception when undefined_table then null; end;
  begin delete from auth.webauthn_credentials where user_id = uid; exception when undefined_table then null; end;

  -- Auth audit log holds the person's sign-in IP addresses in its payload.
  begin
    delete from auth.audit_log_entries where payload->>'actor_id' = uid::text;
  exception when undefined_table or undefined_column then null; end;
end;
$$;

alter function public.admin_anonymise_account(uuid) owner to postgres;
revoke all on function public.admin_anonymise_account(uuid) from public;
grant execute on function public.admin_anonymise_account(uuid) to service_role;

-- The self-serve wrapper is unchanged in behaviour; re-asserted here so this
-- migration is self-contained if read on its own.
create or replace function public.anonymise_own_account()
    returns void
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'You must be signed in to close your account.';
  end if;
  perform public.admin_anonymise_account(uid);
end;
$$;

alter function public.anonymise_own_account() owner to postgres;
revoke all on function public.anonymise_own_account() from public;
grant execute on function public.anonymise_own_account() to authenticated;
grant execute on function public.anonymise_own_account() to service_role;
