-- submit guard: the agreement must be the CURRENT version, not just any acceptance
--
-- WHAT CHANGED, AND WHY.
--
-- submit_service_provider() checked only that *an* acceptance row existed for
-- the role's agreement — any version. So once the Tradesperson / Experience
-- Provider Agreement wording is updated (its `version` bumped in
-- lib/agreements.ts), a provider who had agreed to the OLD text could still
-- submit against that stale acceptance: the server never noticed the change,
-- and only the wizard re-prompted them. Relying on the wizard alone is the gap
-- (Liam, 8 Oct 2026) — a crafted submit, or a future route that skips the
-- wizard, would sail past an out-of-date agreement.
--
-- Now the function requires an acceptance at the CURRENT version. The version
-- lives in the browser's single source of truth, lib/agreements.ts (AGREEMENTS
-- [...].version); the RPC is called straight from the browser with no server
-- route in between, so the function cannot read that constant and a version the
-- browser passed could be a stale page's. So the required version is carried
-- here, exactly as MIN_DESCRIPTION's 40 is carried in the description check —
-- and tests/trade-submit-guard.test.ts fails the build if either string drifts
-- from AGREEMENTS, so a wording bump is two edits (lib/agreements.ts and a new
-- migration like this one), never one. All four agreements are at
-- v1-2026-10-03 today, so no current acceptance is invalidated by this.
--
-- Everything else is unchanged, carried forward from
-- 20261008073933_trade_submit_no_longer_needs_a_separate_service.sql: the owner
-- and approved checks, the guest/host description rules, the host pricing and
-- coverage-area rules.

create or replace function "public"."submit_service_provider"("p_id" uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner            uuid;
    v_status           text;
    v_audience         text;
    v_description      text;
    v_quote            boolean;
    v_hourly           numeric;
    v_flat             numeric;
    v_areas            int;
    v_document         text;
    v_required_version text;
    v_title            text;
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
    -- unticked or stale one), AT THE CURRENT VERSION. An acceptance of an older
    -- wording no longer counts — a wording bump forces re-acceptance here, not
    -- just in the wizard. v_required_version mirrors AGREEMENTS[...].version in
    -- lib/agreements.ts; the guard test keeps the two in step.
    v_document := case when v_audience = 'guest' then 'experience_provider' else 'tradesperson' end;
    v_required_version := case when v_audience = 'guest' then 'v1-2026-10-03' else 'v1-2026-10-03' end;
    v_title := case when v_document = 'experience_provider' then 'Experience Provider Agreement' else 'Tradesperson Agreement' end;
    if not exists (
        select 1 from "public"."agreement_acceptances"
         where "user_id" = v_owner and "document" = v_document and "version" = v_required_version
    ) then
        -- Tailored so a stale acceptance reads differently from never having
        -- agreed — but both block the submit until the current wording is agreed.
        if exists (
            select 1 from "public"."agreement_acceptances"
             where "user_id" = v_owner and "document" = v_document
        ) then
            raise exception 'The % was updated. Please read it again and agree to the current version to continue.', v_title;
        else
            raise exception 'Please agree to the % to continue.', v_title;
        end if;
    end if;

    update "public"."service_providers"
       set "status"       = 'pending_review',
           "submitted_at"  = now(),
           "review_note"   = null
     where "id" = p_id;
end;
$$;

notify pgrst, 'reload schema';

-- Read back (the current version is now required; a bare existence check is not
-- enough):
--   select
--     position('"version" = v_required_version' in pg_get_functiondef('public.submit_service_provider(uuid)'::regprocedure)) > 0
--     and position('v1-2026-10-03' in pg_get_functiondef('public.submit_service_provider(uuid)'::regprocedure)) > 0;
--     -- true
