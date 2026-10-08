-- submit guard: a host trade no longer needs a separate "service"
--
-- WHAT CHANGED, AND WHY.
--
-- submit_service_provider() refused a host trade with no row in
-- service_provider_skills and no offered service_provider_extra — "a trade
-- listing needs at least one service before it can be submitted". But a trade
-- already says what it does when it picks its trade from the tiles on the
-- first screen (a plumber picks Plumber); the wizard then asks only HOW they
-- work (Emergency / Scheduled, stored as the does_emergency / does_scheduled
-- columns, which this check never counted) and never requires a separate,
-- more specific "service". So a plumber who picked Plumber, set their times
-- and their price filled the whole wizard, reached an enabled "Send for
-- review", and was refused here with nothing the wizard had asked for — a
-- silent server-only wall (Liam, 8 Oct 2026).
--
-- The trade IS the service, so that requirement is dropped. Everything else
-- is unchanged, copied from 20261005101500_submit_guard_guest_description.sql:
-- a host trade still needs a description (its professional title stands in for
-- it), a way to price the job, at least one coverage area, and its agreement
-- on record; a guest experience still needs a description; an approved row
-- still returns early.

create or replace function "public"."submit_service_provider"("p_id" uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner       uuid;
    v_status      text;
    v_audience    text;
    v_description text;
    v_quote       boolean;
    v_hourly      numeric;
    v_flat        numeric;
    v_areas       int;
    v_document    text;
begin
    select "owner_id", "status", "audience", "description",
           "provides_quote", "hourly_rate", "flat_fee"
      into v_owner, v_status, v_audience, v_description,
           v_quote, v_hourly, v_flat
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

    -- A guest experience must describe itself ("What happens") in a sentence
    -- or two — MIN_DESCRIPTION (40) in lib/serviceProviders.ts. It prices per
    -- item, so the trade pricing rules below don't apply to it.
    if v_audience = 'guest' and char_length(btrim(coalesce(v_description, ''))) < 40 then
        raise exception 'A guest experience needs a description (say what happens, in a sentence or two) before it can be submitted.';
    end if;

    -- A host trade must say what it does and how it charges before the queue
    -- receives it. "What it does" is the trade itself, chosen up front, so this
    -- no longer demands a separate service — only a (title-backed) description,
    -- a way to price the job, and at least one coverage area.
    if v_audience is distinct from 'guest' then
        if coalesce(btrim(v_description), '') = '' then
            raise exception 'a trade listing needs a description before it can be submitted';
        end if;

        if not (coalesce(v_quote, false)
                or coalesce(v_hourly, 0) > 0
                or coalesce(v_flat, 0) > 0) then
            raise exception 'a trade listing needs a way to price the job (a quote, an hourly rate or a flat fee) before it can be submitted';
        end if;

        select count(*) into v_areas
          from "public"."service_areas"
         where "provider_id" = p_id;
        if v_areas = 0 then
            raise exception 'a trade listing needs at least one coverage area before it can be submitted';
        end if;
    end if;

    -- The role's agreement, recorded by /api/agreements (which refuses an
    -- unticked or stale one). No acceptance on record, no submit.
    v_document := case when v_audience = 'guest' then 'experience_provider' else 'tradesperson' end;
    if not exists (
        select 1 from "public"."agreement_acceptances"
         where "user_id" = v_owner and "document" = v_document
    ) then
        raise exception 'Please agree to the % to continue.',
            case when v_document = 'experience_provider' then 'Experience Provider Agreement' else 'Tradesperson Agreement' end;
    end if;

    update "public"."service_providers"
       set "status"       = 'pending_review',
           "submitted_at"  = now(),
           "review_note"   = null
     where "id" = p_id;
end;
$$;

notify pgrst, 'reload schema';

-- Read back (the services requirement is gone, the coverage-area one remains):
--   select
--     position('needs at least one service' in pg_get_functiondef('public.submit_service_provider(uuid)'::regprocedure)) = 0
--     and position('needs at least one coverage area' in pg_get_functiondef('public.submit_service_provider(uuid)'::regprocedure)) > 0;
--     -- true
