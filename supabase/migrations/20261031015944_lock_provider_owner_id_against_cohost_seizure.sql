-- C1 (AUDIT-OVERNIGHT-2026-10-31): a listing co-host could seize a provider
-- business and redirect its Stripe payouts.
--
-- service_providers.owner_id was in the `authenticated` UPDATE column grant
-- (20260827185827), which its own comment justified as safe *because the only
-- row policy then pinned owner_id = auth.uid() on both USING and WITH CHECK*.
-- The co-host editor policy added later (20261020135822) is a SECOND permissive
-- UPDATE policy whose WITH CHECK is has_provider_permission(id,'can_listing')
-- and does NOT constrain owner_id. PostgreSQL combines permissive policies with
-- OR, so a `can_listing` co-host could run
--
--     supabase.from('service_providers').update({ owner_id: '<self>' }).eq('id', P)
--
-- straight from the browser — the co-host WITH CHECK branch stays true (the
-- provider_access rows are unchanged), so it passes — and become the owner.
-- That hands them the Stripe/Connect payout destination (via the legitimate
-- /api/services/payout-settings route, which selects by owner_id = userId), the
-- power to close the account, and the primary-owner seat. The real owner is
-- overwritten and locked out. There was no BEFORE UPDATE trigger guarding
-- owner_id.
--
-- THE MODEL IS THE COTTAGE-LET SIDE, which is NOT exposed: listings has one
-- UPDATE policy that pins host_id in WITH CHECK (20261021110000), no co-host
-- direct UPDATE policy, and the co-host listing editor writes through a service
-- route. owner_id on a provider is set ONCE, at sign-up (INSERT, pinned to
-- auth.uid()), and is never changed afterwards: there is no ownership-transfer
-- or checkout flow that moves it, the account scrub deliberately keeps it
-- (lib/deactivateAccount, app/api/account/delete), and the billing /
-- reactivation patches never touch it. The Stripe and payout columns were never
-- in the browser write grant at all and stay out.
--
-- Two locks, no new mechanism — a column-grant revoke like the cottage side's
-- host_id handling, and a BEFORE UPDATE trigger like the ones already guarding
-- money columns elsewhere:
--
--   1. Take owner_id OUT of the `authenticated` UPDATE grant, so neither a
--      co-host nor the owner can change it from the browser at all. INSERT keeps
--      it — the sign-up form sets it and the row policy pins it to auth.uid().
--
--   2. A BEFORE UPDATE trigger that refuses any change to owner_id, for every
--      role (service_role included), so even a future loosened policy, a leaked
--      column grant, or an accidental service-role write cannot move ownership.
--      It compares values, so a service-role UPDATE that re-states the same
--      owner_id (the sign-up save does this) still passes.
--
-- ORDERING. Pure tightening: no browser or service flow writes owner_id on an
-- UPDATE, so nothing breaks. Lands on TEST and PRODUCTION on its own. Not
-- --destructive.

revoke update ("owner_id") on table "public"."service_providers" from "authenticated";

create or replace function public.service_providers_owner_id_is_immutable()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
    if new.owner_id is distinct from old.owner_id then
        raise exception 'service_providers.owner_id cannot be changed (the business owner is set once at sign-up)';
    end if;
    return new;
end;
$function$;

drop trigger if exists lock_service_providers_owner_id on public.service_providers;
create trigger lock_service_providers_owner_id
    before update on public.service_providers
    for each row
    execute function public.service_providers_owner_id_is_immutable();

notify pgrst, 'reload schema';

-- Read back — owner_id must be INSERT-grantable to authenticated but NOT
-- UPDATE-grantable, and the trigger must exist:
--   select has_column_privilege('authenticated','public.service_providers','owner_id','INSERT') as insert_owner,  -- expect t
--          has_column_privilege('authenticated','public.service_providers','owner_id','UPDATE') as update_owner,  -- expect f
--          exists (select 1 from pg_trigger where tgname = 'lock_service_providers_owner_id'
--                    and tgrelid = 'public.service_providers'::regclass) as has_trigger;                          -- expect t
