-- submit guard: a set-times or comes-to-you experience needs its weekly hours
--
-- WHAT CHANGED, AND WHY.
--
-- B's audit found that approving a guest experience made it live with no
-- availability: a set-times (slot) experience generates its bookable times from
-- the weekly template, and a comes-to-you experience reads the template for the
-- dates a guest may request, so both are useless the moment they are approved
-- with an empty template — "live" with nothing a guest can book (Liam,
-- 20 Oct 2026). Weekly hours left the sign-up wizard (they are set in the
-- listing editor's Availability section now), so a provider could reach submit,
-- and an admin could reach Approve, with none set.
--
-- So submit now refuses a GUEST whose shape is 'slot' or 'comes_to_you' until it
-- has at least one row in slot_availability — the weekly template. A
-- made-to-order product has no weekly hours and is unaffected; a host trade is
-- unaffected. The admin Approve gate mirrors this in the decision route
-- (lib/serviceProviders.ts approvalBlockers / needsWeeklyHours). Experiences
-- already approved return early, so they are not touched.
--
-- Everything else is carried forward unchanged from
-- 20261008095939_submit_guard_checks_agreement_version.sql: the owner and
-- approved checks, the guest/host description rules, the host pricing and
-- coverage-area rules, and the current-version agreement wall.

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
    v_shape            text;
    v_description      text;
    v_quote            boolean;
    v_hourly           numeric;
    v_flat             numeric;
    v_areas            int;
    v_hours            int;
    v_document         text;
    v_required_version text;
    v_title            text;
begin
    select "owner_id", "status", "audience", "shape", "description",
           "provides_quote", "hourly_rate", "flat_fee"
      into v_owner, v_status, v_audience, v_shape, v_description,
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

    -- A set-times or comes-to-you experience is bookable off its weekly hours,
    -- so it cannot be submitted (nor, mirrored in the Approve gate, approved)
    -- with an empty template. Made-to-order has no hours and is not gated.
    if v_audience = 'guest' and v_shape in ('slot', 'comes_to_you') then
        select count(*) into v_hours
          from "public"."slot_availability"
         where "provider_id" = p_id;
        if v_hours = 0 then
            raise exception 'Set your weekly opening hours before submitting — guests book from them, so there is nothing to book without them.';
        end if;
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

-- Read back (the weekly-hours clause is present; the version wall remains):
--   select
--     position('weekly opening hours before submitting' in pg_get_functiondef('public.submit_service_provider(uuid)'::regprocedure)) > 0
--     and position('"version" = v_required_version' in pg_get_functiondef('public.submit_service_provider(uuid)'::regprocedure)) > 0;
--     -- true
