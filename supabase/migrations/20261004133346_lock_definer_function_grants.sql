-- Lock EXECUTE on every function in the public schema to what its callers need,
-- and stop new functions being granted to the browser roles by default.
--
-- THE HOLE (#296 closed it for the account functions; this closes it for all).
-- Supabase's default privileges grant EXECUTE on every new function directly to
-- anon and authenticated (pg_default_acl, owner postgres, read on prod 4 Oct
-- 2026). Migrations that did `revoke all ... from public` left those direct
-- grants in place, so 26 public functions on production were executable with
-- the public site key, 21 of them by anon — including SECURITY DEFINER jobs
-- (expire_unpaid_bookings, publish_expired_reviews, refresh_listing_ratings)
-- that run as the table owner.
--
-- THE RULE NOW. Every function in public loses EXECUTE for PUBLIC, anon and
-- authenticated; service_role keeps it (it bypasses RLS anyway, and every
-- server-side rpc() uses it). Then exactly these are granted back, each because
-- a real caller needs it (tests/function-grants-guard.test.ts holds the list and
-- the reason, and fails on anything else):
--
--   may_read_listing(uuid,uuid)      anon, authenticated — the listings_readable
--       SELECT policy applies to every role (public listing pages); answers only
--       about auth.uid().
--   owns_order(uuid)                  authenticated — booking_guests "order guests
--       readable" policy; answers only about auth.uid(). The policy is narrowed
--       to authenticated below, so anon never evaluates it (and can't throw).
--   is_order_message_participant(uuid) authenticated — messages policies (already
--       authenticated-only); answers only about auth.uid().
--   order_reviewable_by(uuid,uuid)    authenticated — reviews INSERT policy, which
--       passes auth.uid(). Now refuses any other user id, so a direct call can't
--       probe someone else's orders.
--   submit_service_provider(uuid)     authenticated — the sign-up wizard; refuses
--       a listing the caller doesn't own.
--   deactivate_own_account(), anonymise_own_account() authenticated — the account
--       routes call them as the signed-in user; act on auth.uid() only.
--
-- Everything else gets nothing: trigger functions (a trigger fires without the
-- caller holding EXECUTE), the pg_cron jobs (run as postgres), refresh_listing_
-- ratings (only called inside the definer trigger on_review_change),
-- render_template (only called inside send_due_scheduled_messages), and
-- my_account_deactivation_blockers (no caller).
--
-- THE ROOT CAUSE. Default privileges for functions created by postgres (every
-- migration runs as postgres) no longer include PUBLIC, anon or authenticated.
-- supabase_admin's defaults are changed too where this role is allowed to;
-- if not, that is reported and the guard test still catches anything it creates.
--
-- Safe to run twice. Read back at the bottom.

-- 1. Revoke from the browser roles on every non-extension function in public;
--    keep service_role.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('grant execute on function %s to service_role', f.sig);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 2. order_reviewable_by answers only for the caller.
create or replace function public.order_reviewable_by(p_order uuid, p_guest uuid)
    returns boolean
    language sql
    stable security definer
    set search_path to 'public'
as $function$
    select p_guest = auth.uid() and exists (
        select 1 from public.service_orders
        where id = p_order
          and guest_id = p_guest
          and status = 'confirmed'
          and service_date < current_date
    );
$function$;

-- 3. The booking_guests order policy is for signed-in users only (anon owns no
--    order); with that, owns_order needs no anon grant.
alter policy "order guests readable" on public.booking_guests to authenticated;

-- 4. Grant back exactly what callers need.
grant execute on function public.may_read_listing(uuid, uuid)          to anon, authenticated;
grant execute on function public.owns_order(uuid)                       to authenticated;
grant execute on function public.is_order_message_participant(uuid)     to authenticated;
grant execute on function public.order_reviewable_by(uuid, uuid)        to authenticated;
grant execute on function public.submit_service_provider(uuid)          to authenticated;
grant execute on function public.deactivate_own_account()               to authenticated;
grant execute on function public.anonymise_own_account()                to authenticated;

-- 5. The root cause: new functions are no longer granted to the browser roles.
alter default privileges for role postgres                  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public, anon, authenticated';
exception when insufficient_privilege then
  raise notice 'supabase_admin default privileges not changeable by this role; the guard test still catches its functions';
end $$;

notify pgrst, 'reload schema';

-- Read back:
--   select p.oid::regprocedure, has_function_privilege('anon',p.oid,'execute'),
--          has_function_privilege('authenticated',p.oid,'execute')
--     from pg_proc p where p.pronamespace='public'::regnamespace
--      and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'));
--     -- exactly the seven above (may_read_listing anon+auth, the rest auth only)
--   select pg_get_userbyid(defaclrole), defaclacl from pg_default_acl where defaclobjtype='f';
--     -- postgres: no anon/authenticated/PUBLIC
