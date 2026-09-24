-- Finding (overnight audit 2026-09-24, LAUNCH BLOCKER): account deletion had no
-- valid erasure path. delete_own_account() deletes auth.users, which cascades to
-- profiles and, from there, to bookings/reviews/messages/listings and the whole
-- provider subtree. In practice that means one of two bad outcomes on the live
-- cottage side (4 payments on 5 bookings today):
--   * a user with any money/audit row: payments/payouts are RESTRICT, so the
--     cascade is blocked mid-transaction and the account page surfaces a raw
--     Postgres error — erasure simply fails;
--   * a money-free user: the cascade DESTROYS their bookings/reviews/messages/
--     listings — records erasure was never meant to destroy.
-- Personal images (avatars/headshots/listing photos in the public `listings`
-- bucket) are left dangling and publicly reachable either way.
--
-- Business direction (from the audit): anonymise, don't delete. Scrub personal
-- data, keep every financial/booking/audit row intact and linked.
--
-- This migration:
--   1. adds profiles.anonymised_at (the tombstone);
--   2. replaces delete_own_account() with anonymise_own_account() — a
--      SECURITY DEFINER routine that, in one transaction, scrubs the caller's
--      personal data across profiles + any owned service_providers, unpublishes
--      any listings they host, and disables their auth identity, while leaving
--      bookings/payments/payouts/orders untouched. The app (service role,
--      storage API) removes the person's images AFTER this returns, so the
--      listings are already unpublished before their photos disappear and no
--      broken listing is left public; see app/api/account/delete/route.ts.
--   3. flips bookings.guest_id/host_id from ON DELETE CASCADE to RESTRICT, so a
--      profile delete can never destroy booking history even if some other path
--      ever deletes a profile.
--
-- NOTE ON APPLYING: additive/replace parts (add column, create function) are
-- safe any time. The two FK swaps drop-and-recreate a constraint; they lose no
-- data. Nothing here needs deploying in a particular order relative to the code,
-- because the old delete_own_account() is dropped and the new route calls the
-- new function.

-- 1. Tombstone -------------------------------------------------------------
alter table public.profiles add column if not exists anonymised_at timestamptz;

-- 2. The anonymise routine -------------------------------------------------
drop function if exists public.delete_own_account();

-- The worker: scrub a given account. SECURITY DEFINER so it can reach auth.* and
-- bypass RLS; granted to service_role only. The self-serve wrapper below calls it
-- with auth.uid(); an admin/support path (and the tests) can call it directly.
create or replace function public.admin_anonymise_account(target uuid)
    returns void
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  uid uuid := target;
  blocking int;
begin
  if uid is null then
    raise exception 'No account given to anonymise.';
  end if;

  if not exists (select 1 from auth.users where id = uid) then
    raise exception 'This account no longer exists.';
  end if;

  -- Refuse while there are still live bookings in play, as guest or as host.
  -- They must be cancelled first so nobody is left with a stay against an
  -- account that no longer answers.
  select count(*) into blocking
  from public.bookings
  where (guest_id = uid or host_id = uid)
    and status in ('pending', 'confirmed')
    and check_out >= current_date;

  if blocking > 0 then
    raise exception
      'This account still has % upcoming or pending booking(s). Cancel them before closing it.',
      blocking;
  end if;

  -- profiles: null/scramble every personal field, keep the row (and its
  -- financial/audit links) intact. full_name carries a readable tombstone so
  -- lists that render a name show "Deleted user" rather than a blank.
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

  -- service_providers (if this user owns one): scrub every field that carries
  -- the person or their own words — business/contact/address, the photo paths,
  -- and the free-text/JSON they wrote about themselves and their offering
  -- (provider_name, the guest_details answers, the dietary note, and the
  -- declarations they confirmed). Keep the row so orders/payouts stay linked.
  -- Three of these are NOT NULL, so they are reset to their empty sentinel
  -- rather than nulled — description ('' default), photos ('{}' default) and
  -- declarations ('{}' default). Nulling any of them raises a not-null
  -- violation and aborts the whole erasure. (about/what_to_expect were dropped
  -- in 20260901140000, so they are not touched here.)
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
    logo = null
  where owner_id = uid;

  -- listings: unpublish anything this user hosts before their images are
  -- removed by the app, so no listing is left publicly reachable with its
  -- photos (and its host) gone. 'hidden' is the "was live, taken down" state;
  -- pending_review is folded in so an owner can't later approve a dead host's
  -- listing. Drafts stay drafts — they were never public.
  update public.listings set status = 'hidden'
  where host_id = uid and status in ('published', 'pending_review');

  -- auth.users: scramble the login identity so the person can never sign back
  -- in and no personal data survives in the auth schema, but keep the row so
  -- every FK to it stays valid.
  update auth.users set
    email = 'deleted+' || uid::text || '@invalid.example',
    phone = null,
    raw_user_meta_data = '{}'::jsonb,
    raw_app_meta_data = jsonb_build_object('provider', 'deleted', 'providers', '[]'::jsonb),
    banned_until = now() + interval '100 years'
  where id = uid;

  -- Revoke every live credential: sessions, refresh tokens and identities
  -- (deleting the identity frees the old email and makes OAuth/email sign-in
  -- impossible). Wrapped so a GoTrue schema variant that lacks one of these
  -- tables does not abort the whole erasure.
  begin delete from auth.sessions where user_id = uid; exception when undefined_table then null; end;
  begin delete from auth.refresh_tokens where user_id::text = uid::text; exception when undefined_table then null; end;
  begin delete from auth.identities where user_id = uid; exception when undefined_table then null; end;
end;
$$;

alter function public.admin_anonymise_account(uuid) owner to postgres;
revoke all on function public.admin_anonymise_account(uuid) from public;
grant execute on function public.admin_anonymise_account(uuid) to service_role;

-- The self-serve wrapper: a signed-in user closes their OWN account. Thin on
-- purpose — it only resolves the caller and delegates to the worker.
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

-- 3. Booking history can never be destroyed by a profile delete ------------
alter table public.bookings drop constraint if exists bookings_guest_id_fkey;
alter table public.bookings add constraint bookings_guest_id_fkey
    foreign key (guest_id) references public.profiles(id) on delete restrict;

alter table public.bookings drop constraint if exists bookings_host_id_fkey;
alter table public.bookings add constraint bookings_host_id_fkey
    foreign key (host_id) references public.profiles(id) on delete restrict;
