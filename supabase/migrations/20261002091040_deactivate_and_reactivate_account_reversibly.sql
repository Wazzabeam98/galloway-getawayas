-- deactivate and reactivate account reversibly
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- Account closure had exactly one shape: anonymise_own_account() (migration
-- 20260924181742), which is PERMANENT erasure — it scrubs the person's data,
-- bans the login for 100 years and can never be undone. There was nothing
-- between "leave it open" and "destroy it", so a host who wants to step away
-- for a season, or a guest who wants their profile off the site for a while,
-- had no safe option but the irreversible one.
--
-- This adds DEACTIVATION: reversible, data kept, the mirror of Airbnb's
-- "deactivate your account". The profile and the person's listings/experiences
-- are hidden, their login is suspended (banned_until, but a date we can lift —
-- not the 100-year tombstone erasure uses), and every row is left intact so the
-- account can be brought back. Reactivation is deliberately NOT self-serve: it
-- is reactivate_account(), granted to service_role only, run by us when the
-- person asks. A suspended login cannot sign in to undo its own suspension.
--
-- The money that a deactivation sets in motion — refunding the person's own
-- upcoming trips under the cancellation policy, and cancelling a trade's Stripe
-- subscription — is done by the route (app/api/account/deactivate) BEFORE it
-- calls deactivate_own_account(), because money moves before a status changes
-- (CLAUDE.md) and because Stripe is not reachable from SQL. What stays in SQL is
-- the part that must be one atomic, guarded step: the block check, the hiding,
-- and the login suspension.
--
-- THE BLOCK (account_deactivation_blockers). A listing/experience/trade that
-- still has other people's reservations or open requests on it cannot be taken
-- down out from under them — the person must see those out or cancel them
-- first. We refuse to auto-cancel a stranger's confirmed, paid stay from a
-- self-serve button; only the person's OWN upcoming trips (as guest) are
-- cancelled with the policy applied. The blocker set is a single SQL function
-- so the friendly pre-check the route shows and the hard guard the RPC enforces
-- can never drift apart (a guard that throws is worse than no guard — it must
-- be the same test the UI promised).
--
-- PRE-FLIGHT. Not destructive: three additive nullable columns and three new
-- functions. The columns are distinct from anonymised_at (erasure) on purpose —
-- deactivated_at is the reversible tombstone, anonymised_at the permanent one.
-- No CHECK constraint is widened: 'hidden' is already a legal status for both
-- listings and service_providers, and deactivated_at is a bare timestamptz.

-- 1. Reversible tombstones -------------------------------------------------
alter table public.profiles          add column if not exists deactivated_at timestamptz;
alter table public.listings          add column if not exists deactivated_at timestamptz;
alter table public.service_providers add column if not exists deactivated_at timestamptz;

-- No grant. These are server-only lifecycle tombstones, exactly like
-- profiles.anonymised_at and service_providers.owner_paused: written only by the
-- SECURITY DEFINER routines below and read only via the service role (the admin
-- reactivation path, the directory loads). No browser surface reads them — a
-- deactivated account is signed out and suspended — so the column-level SELECT
-- allow-lists on these tables deliberately leave them out. The
-- select-grant-decision-guard test records this as REVOKED, with the reason.
-- (These tables forbid `select('*')` from the browser, so an ungranted column
-- breaks nothing.)

-- 2. The blocker set -------------------------------------------------------
-- Everything that must be dealt with before the account can be deactivated.
-- Returns one row per blocking thing, named, so the route can tell the person
-- exactly which listing/experience/trade to sort out. SECURITY DEFINER because
-- it reads across bookings/service_orders/service_enquiries, which RLS would
-- otherwise narrow to the caller's own rows (a co-host is not the host_id).
--
-- What blocks, and why only these:
--   * a listing with a pending or confirmed booking whose check-out is today or
--     later — a stranger's stay we will not cancel on their behalf;
--   * an experience with an authorised (requested, card held) or confirmed
--     order whose service date is today or later;
--   * a trade with an open (sent/viewed) or accepted enquiry — an introduction
--     in flight, no on-platform money;
--   * the person's OWN stay that is already in progress (checked in, not yet
--     checked out) — they cannot walk away mid-stay, and it is too late to
--     cancel it online.
-- The person's own FUTURE trips do NOT appear here: those are cancelled with
-- the cancellation policy by the route, not blocked.
create or replace function public.account_deactivation_blockers(target uuid)
    returns table (kind text, entity_id uuid, entity_name text, detail text)
    language sql
    stable
    security definer
    set search_path to 'public'
as $$
    -- Accommodation listings the person hosts, with live reservations/requests.
    select 'listing'::text,
           l.id,
           coalesce(nullif(l.title, ''), 'your listing'),
           count(b.id)::text || ' upcoming reservation(s)'
    from public.listings l
    join public.bookings b
      on b.listing_id = l.id
     and b.status in ('pending', 'confirmed')
     and b.check_out >= current_date
    where l.host_id = target
    group by l.id, l.title

    union all
    -- Experiences the person provides, with live orders/requests.
    select 'experience'::text,
           sp.id,
           coalesce(nullif(sp.business_name, ''), 'your experience'),
           count(so.id)::text || ' upcoming order(s)'
    from public.service_providers sp
    join public.service_orders so
      on so.provider_id = sp.id
     and so.status in ('authorised', 'confirmed')
     and so.service_date >= current_date
    where sp.owner_id = target
      and sp.audience = 'guest'
    group by sp.id, sp.business_name

    union all
    -- Trades the person runs, with open or accepted enquiries.
    select 'trade'::text,
           sp.id,
           coalesce(nullif(sp.business_name, ''), 'your trade listing'),
           count(e.id)::text || ' open enquiry(ies)'
    from public.service_providers sp
    join public.service_enquiries e
      on e.provider_id = sp.id
     and e.status in ('sent', 'viewed', 'accepted')
    where sp.owner_id = target
      and sp.audience <> 'guest'
    group by sp.id, sp.business_name

    union all
    -- The person's own stay that has already started.
    select 'stay_in_progress'::text,
           b.id,
           'a stay in progress',
           'you are mid-stay until ' || to_char(b.check_out, 'DD/MM/YYYY')
    from public.bookings b
    where b.guest_id = target
      and b.status = 'confirmed'
      and b.check_in <= current_date
      and b.check_out > current_date;
$$;

alter function public.account_deactivation_blockers(uuid) owner to postgres;
revoke all on function public.account_deactivation_blockers(uuid) from public;
-- The caller-supplied-id form is the ADMIN/server path only: service_role (the
-- route's admin client, the support reactivation flow) can ask about any
-- account. It is NOT granted to `authenticated` — this is SECURITY DEFINER, so
-- a direct `authenticated` grant let any signed-in person pass someone else's
-- id and read which listings/experiences they own, how many reservations they
-- have, and that they are mid-stay (away from home) until a given date. The
-- browser asks about its OWN account only, through the no-arg wrapper below.
grant execute on function public.account_deactivation_blockers(uuid) to service_role;

-- The self-only wrapper: a signed-in person asks for their OWN blockers and
-- nobody else's. auth.uid() is the identity — there is no argument to spoof.
-- This is what any browser/authenticated surface calls; the two-arg form stays
-- server-only. Mirror of deactivate_own_account() wrapping admin_deactivate_account().
create or replace function public.my_account_deactivation_blockers()
    returns table (kind text, entity_id uuid, entity_name text, detail text)
    language sql
    stable
    security definer
    set search_path to 'public'
as $$
    select * from public.account_deactivation_blockers(auth.uid());
$$;

alter function public.my_account_deactivation_blockers() owner to postgres;
revoke all on function public.my_account_deactivation_blockers() from public;
grant execute on function public.my_account_deactivation_blockers() to authenticated, service_role;

-- 3. The deactivation worker ----------------------------------------------
-- Suspend a given account: hide the profile, hide the listings/experiences it
-- owns (stamping deactivated_at so reactivation can put back exactly the ones
-- WE hid, and not a draft or a listing the host had already hidden by hand),
-- and suspend the login. It does NOT touch money: the route has already
-- refunded the person's trips and stopped any subscription before calling this.
-- SECURITY DEFINER to reach auth.* and bypass RLS; the self-serve wrapper calls
-- it with auth.uid(), an admin/support path can call it directly.
create or replace function public.admin_deactivate_account(target uuid)
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
    raise exception 'No account given to deactivate.';
  end if;

  if not exists (select 1 from auth.users where id = uid) then
    raise exception 'This account no longer exists.';
  end if;

  -- The hard guard. Same test the route showed the person; re-run here so a
  -- reservation that landed between the pre-check and now still stops it.
  select count(*) into blocking from public.account_deactivation_blockers(uid);
  if blocking > 0 then
    raise exception
      'This account still has % listing(s) or booking(s) to deal with before it can be deactivated.',
      blocking;
  end if;

  -- Profile: the reversible tombstone. No personal field is scrubbed — this is
  -- not erasure; the data is kept so the account can come back intact.
  update public.profiles set deactivated_at = now()
  where id = uid and deactivated_at is null;

  -- Listings: hide only the ones that are LIVE right now, and stamp them, so
  -- reactivation republishes exactly these. A draft or an already-hidden
  -- listing is left as it is and carries no stamp.
  update public.listings set status = 'hidden', deactivated_at = now()
  where host_id = uid and status = 'published';

  -- Experiences / trades: same — hide only the ones currently approved
  -- (publicly visible) and stamp them.
  update public.service_providers set status = 'hidden', deactivated_at = now()
  where owner_id = uid and status = 'approved';

  -- Login: suspend it. banned_until is a real date we can lift on
  -- reactivation, NOT the 100-year value erasure uses. Kept reversible on
  -- purpose: a deactivated account is coming back, a deleted one never is.
  update auth.users set banned_until = now() + interval '100 years'
  where id = uid;

  -- Sign them out everywhere so the suspension bites immediately. Identities
  -- are KEPT (unlike erasure, which deletes them) so the same email/OAuth works
  -- again after reactivation.
  begin delete from auth.sessions where user_id = uid; exception when undefined_table then null; end;
  begin delete from auth.refresh_tokens where user_id::text = uid::text; exception when undefined_table then null; end;
end;
$$;

alter function public.admin_deactivate_account(uuid) owner to postgres;
revoke all on function public.admin_deactivate_account(uuid) from public;
grant execute on function public.admin_deactivate_account(uuid) to service_role;

-- The self-serve wrapper: a signed-in person deactivates their OWN account.
create or replace function public.deactivate_own_account()
    returns void
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'You must be signed in to deactivate your account.';
  end if;
  perform public.admin_deactivate_account(uid);
end;
$$;

alter function public.deactivate_own_account() owner to postgres;
revoke all on function public.deactivate_own_account() from public;
grant execute on function public.deactivate_own_account() to authenticated, service_role;

-- 4. Reactivation — NOT self-serve ----------------------------------------
-- Bring a deactivated account back. Lift the login suspension, un-hide the
-- profile, and republish exactly the listings/experiences that WE hid (the ones
-- carrying deactivated_at), clearing the stamp. Granted to service_role only:
-- the person asks us, we run it. A trade's Stripe subscription is NOT restarted
-- here — a cancelled subscription cannot be revived from SQL, and the trade
-- re-subscribes through the normal billing flow when they come back.
create or replace function public.reactivate_account(target uuid)
    returns void
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  uid uuid := target;
begin
  if uid is null then
    raise exception 'No account given to reactivate.';
  end if;

  update public.profiles set deactivated_at = null
  where id = uid;

  update public.listings set status = 'published', deactivated_at = null
  where host_id = uid and deactivated_at is not null;

  update public.service_providers set status = 'approved', deactivated_at = null
  where owner_id = uid and deactivated_at is not null;

  -- Lift the suspension so they can sign in again.
  update auth.users set banned_until = null
  where id = uid;
end;
$$;

alter function public.reactivate_account(uuid) owner to postgres;
revoke all on function public.reactivate_account(uuid) from public;
grant execute on function public.reactivate_account(uuid) to service_role;
