-- Reactivating an account no longer puts its listings back on the site.
--
-- WHY. Liam, 4 Oct 2026: the person relists their own listings, experiences
-- and trade when they're ready — the way Airbnb leaves it to the host — and a
-- reactivation must never lift an admin take-down. The old reactivate_account
-- republished every listing and re-approved every provider the deactivation
-- had hidden, the moment the login came back.
--
-- WHAT IT DOES NOW
--
--   * Listings the deactivation hid stay 'hidden'; only the deactivated_at stamp
--     is cleared. The host puts each back with their own Hide/Unhide control
--     (/api/listings/visibility accepts hidden → published).
--   * Experiences / trades the deactivation hid go back to status 'approved'
--     with owner_paused = true. 'approved' matters: every provider dashboard,
--     calendar and earnings page redirects anything else into the sign-up flow,
--     so a provider left 'hidden' would be locked out of their own listing.
--     owner_paused keeps it off the site until they press "Put it back up" in
--     their editor. admin_hidden_at is NOT touched, so an admin take-down holds
--     whatever the provider presses.
--   * Profile un-hidden and login un-suspended, as before.
--
-- Only rows carrying the deactivation stamp are touched (deactivation stamps
-- only listings that were 'published' and providers that were 'approved'), so a
-- draft, an application or a listing hidden by hand before is left exactly as
-- it was.
--
-- 2. admin_actions learns 'account_reactivated'. For that action host_id is the
--    reactivated person and listing_id/provider_id are null. The check is
--    WIDENED: the six existing actions stay.
--
-- 3. SECURITY FIX — the account-lifecycle functions were callable by anyone.
--    Their migrations did `revoke all ... from public` then granted the
--    intended role, but Supabase's default privileges had ALREADY granted
--    EXECUTE directly to anon and authenticated at create time, and revoking
--    from PUBLIC doesn't remove a direct grant. Read on TEST 4 Oct 2026: anon
--    and authenticated could execute admin_deactivate_account(target),
--    admin_anonymise_account(target) and reactivate_account(target) — i.e. the
--    public site key could suspend, erase or revive ANY account by id (host
--    ids are public). Revoked here, explicitly, from both roles:
--      * admin_deactivate_account, admin_anonymise_account, reactivate_account,
--        account_deactivation_blockers → service_role only (every caller is a
--        server route using the service key).
--      * deactivate_own_account, anonymise_own_account,
--        my_account_deactivation_blockers → authenticated + service_role, not
--        anon (they act on auth.uid(); the routes call them as the signed-in
--        user).
--
-- Signature unchanged (uuid → void) and grants re-stated; safe to run twice.

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

  -- Left hidden: the host relists it themselves.
  update public.listings set deactivated_at = null
  where host_id = uid and deactivated_at is not null;

  -- Back to approved so the owner can reach it, but paused so it stays off the
  -- site until they put it back up. An admin take-down (admin_hidden_at) stays.
  update public.service_providers
     set status = 'approved', owner_paused = true, deactivated_at = null
   where owner_id = uid and deactivated_at is not null;

  -- Lift the suspension so they can sign in again.
  update auth.users set banned_until = null
  where id = uid;
end;
$$;

alter function public.reactivate_account(uuid) owner to postgres;
revoke all on function public.reactivate_account(uuid) from public;
grant execute on function public.reactivate_account(uuid) to service_role;

-- 3. The grants (see the header).
revoke execute on function public.reactivate_account(uuid)            from anon, authenticated;
revoke execute on function public.admin_deactivate_account(uuid)      from anon, authenticated;
revoke execute on function public.admin_anonymise_account(uuid)       from anon, authenticated;
revoke execute on function public.account_deactivation_blockers(uuid) from anon, authenticated;
revoke execute on function public.deactivate_own_account()            from anon;
revoke execute on function public.anonymise_own_account()             from anon;
revoke execute on function public.my_account_deactivation_blockers()  from anon;
grant execute on function public.deactivate_own_account()           to authenticated, service_role;
grant execute on function public.anonymise_own_account()            to authenticated, service_role;
grant execute on function public.my_account_deactivation_blockers() to authenticated, service_role;
grant execute on function public.admin_deactivate_account(uuid)      to service_role;
grant execute on function public.admin_anonymise_account(uuid)       to service_role;
grant execute on function public.account_deactivation_blockers(uuid) to service_role;

alter table "public"."admin_actions"
    drop constraint if exists "admin_actions_action_check";

alter table "public"."admin_actions"
    add constraint "admin_actions_action_check" check ("action" = any (array[
        'listing_hidden'::text,
        'listing_relisted'::text,
        'listing_edited'::text,
        'listing_photo_removed'::text,
        'provider_hidden'::text,
        'provider_relisted'::text,
        'account_reactivated'::text
    ]));

-- Read back:
--   select prosrc like '%owner_paused = true%' and prosrc not like '%status = ''published''%'
--     from pg_proc where proname = 'reactivate_account';                         -- true
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'admin_actions_action_check';                               -- seven actions
--   select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
--          has_function_privilege('authenticated', p.oid, 'execute') authd
--     from pg_proc p where p.proname in (...the seven...);   -- anon false everywhere;
--                                                             -- authd true only for the three *_own_/my_ ones
