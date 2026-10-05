-- submit guard: a guest experience needs a description
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- submit_service_provider() is the only way a provider's row reaches
-- 'pending_review', and the browser calls it directly. It checked a host
-- trade's description, pricing, services and coverage, but exempted a guest
-- experience entirely. The sign-up wizard requires a guest to describe the
-- experience ("What happens", at least a sentence or two — MIN_DESCRIPTION in
-- lib/serviceProviders.ts), but that rule lived only in the browser: a direct
-- RPC call could send an experience with no description for review.
--
-- This adds the guest half: a guest experience whose description is shorter
-- than 40 characters (after trimming) is refused. 40 is MIN_DESCRIPTION; a test
-- (tests/trade-submit-guard.test.ts) holds the two equal, and tradeSubmitBlock
-- applies the same rule on /api/services/finish, which writes the status itself.
--
-- Everything else in the function is unchanged, copied from
-- 20260929204632_agreement_acceptances_and_the_submit_wall.sql. An approved row
-- still returns early (re-saving a live listing is never blocked), and rows
-- already pending are untouched — this only gates the next submit.

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
    v_services    int;
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
    -- receives it — the same two rules the wizard enforces.
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

-- Read back:
--   select position('guest experience needs a description' in pg_get_functiondef('public.submit_service_provider(uuid)'::regprocedure)) > 0;
--     -- true
