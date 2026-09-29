-- Server-side wall: a provider cannot be submitted for review without having
-- agreed to the current terms.
--
-- WHY
--
-- The sign-up wizard greys "Send for review" until the terms box is ticked, and
-- records the acceptance (version + timestamp) in service_providers.declarations
-- as { terms_version, terms_agreed_at }. That is a browser gate; this adds the
-- same rule as a wall the browser cannot get around — the one legitimate status
-- write for a signed-in provider goes through submit_service_provider(), so this
-- is where it belongs. A trade AND a guest experience are both held to it now
-- (the wizard gates both), and both record the same declarations.terms_version.
--
-- THE VERSION IS HARDCODED, matching the host-terms pattern
-- (app/api/listings/publish/route.ts checks HOST_TERMS_VERSION). It must stay in
-- sync with PROVIDER_TERMS_VERSION in lib/providerTerms.ts — when the solicitor's
-- terms land and that constant bumps, bump it here too, and everyone is asked to
-- re-accept on their next submit (a stale recorded version no longer matches).
--
-- Everything else about the function is unchanged from
-- 20260929164512_submit_guard_trade_description_and_pricing.sql: security
-- definer, owner check, quiet return for an already-approved listing, and the
-- trade description/pricing guard.
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

    -- A host trade must say what it does and how it charges before the queue
    -- receives it — the same two rules the wizard enforces. A guest experience
    -- prices per item and is exempt.
    if v_audience is distinct from 'guest' then
        if coalesce(btrim(v_description), '') = '' then
            raise exception 'a trade listing needs a description before it can be submitted';
        end if;

        if not (coalesce(v_quote, false)
                or coalesce(v_hourly, 0) > 0
                or coalesce(v_flat, 0) > 0) then
            raise exception 'a trade listing needs a way to price the job (a quote, an hourly rate or a flat fee) before it can be submitted';
        end if;
    end if;

    update "public"."service_providers"
       set "status"       = 'pending_review',
           "submitted_at"  = now(),
           "review_note"   = null
     where "id" = p_id;
end;
$$;
