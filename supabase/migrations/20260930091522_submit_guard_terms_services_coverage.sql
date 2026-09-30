-- The complete go-live wall for submit_service_provider, in one place.
--
-- WHY THIS EXISTS
--
-- Two earlier migrations each recreated this function from a different base: the
-- terms wall (20260929184617) and the audit's services/coverage checks
-- (20260929190533). `create or replace` means whichever runs last wins, so on a
-- fresh apply the later one would silently drop the other's checks. This is the
-- authoritative version that carries ALL of them together, so the function can't
-- lose a rule to migration ordering again.
--
-- THE RULES
--   * Terms — EVERY provider (guest experience and host trade alike): the current
--     terms version must be recorded in declarations. Mirrors the wizard's gated
--     Send. Keep v_terms_wanted in sync with PROVIDER_TERMS_VERSION.
--   * For a host trade (audience distinct from 'guest') only:
--       - a non-blank description;
--       - a pricing signal — quote / hourly / flat;
--       - at least one service — a service_provider_skills row or an offered
--         service_provider_extras row;
--       - at least one coverage area (service_areas) — where they're available to
--         work. This is what "availability" means as a go-live rule; the optional
--         emergency/scheduled ticks are NOT required and are deliberately not
--         checked here.
--
-- Safe to run twice.

create or replace function "public"."submit_service_provider"("p_id" uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner        uuid;
    v_status       text;
    v_audience     text;
    v_description  text;
    v_quote        boolean;
    v_hourly       numeric;
    v_flat         numeric;
    v_services     int;
    v_areas        int;
    v_terms        text;
    -- Keep in sync with PROVIDER_TERMS_VERSION in lib/providerTerms.ts.
    v_terms_wanted text := 'draft-2026-09-07';
begin
    select "owner_id", "status", "audience", "description",
           "provides_quote", "hourly_rate", "flat_fee",
           "declarations" ->> 'terms_version'
      into v_owner, v_status, v_audience, v_description,
           v_quote, v_hourly, v_flat, v_terms
      from "public"."service_providers"
     where "id" = p_id;

    if v_owner is null then
        raise exception 'no such listing';
    end if;

    if v_owner is distinct from auth.uid() then
        raise exception 'that listing is not yours';
    end if;

    if v_status = 'approved' then
        return;
    end if;

    -- The terms wall — every provider, whatever they sell.
    if v_terms is distinct from v_terms_wanted then
        raise exception 'the current terms and conditions must be agreed before this can be submitted';
    end if;

    -- The trade completeness rules — host trades only.
    if v_audience is distinct from 'guest' then
        if coalesce(btrim(v_description), '') = '' then
            raise exception 'a trade listing needs a description before it can be submitted';
        end if;

        if not (coalesce(v_quote, false)
                or coalesce(v_hourly, 0) > 0
                or coalesce(v_flat, 0) > 0) then
            raise exception 'a trade listing needs a way to price the job (a quote, an hourly rate or a flat fee) before it can be submitted';
        end if;

        select count(*) into v_services
          from "public"."service_provider_skills"
         where "provider_id" = p_id;
        if v_services = 0 then
            select count(*) into v_services
              from "public"."service_provider_extras"
             where "provider_id" = p_id and "offered" = true;
        end if;
        if v_services = 0 then
            raise exception 'a trade listing needs at least one service before it can be submitted';
        end if;

        select count(*) into v_areas
          from "public"."service_areas"
         where "provider_id" = p_id;
        if v_areas = 0 then
            raise exception 'a trade listing needs at least one coverage area before it can be submitted';
        end if;
    end if;

    update "public"."service_providers"
       set "status"       = 'pending_review',
           "submitted_at"  = now(),
           "review_note"   = null
     where "id" = p_id;
end;
$$;
