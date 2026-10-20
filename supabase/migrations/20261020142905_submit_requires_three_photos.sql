-- submit guard: a guest experience needs at least three photos
--
-- WHAT CHANGED, AND WHY.
--
-- The sign-up wizard asks for photos but never enforced a minimum, so a guest
-- experience could be submitted (and approved) with one photo, or none. Airbnb
-- holds an experience to at least three, which is what makes a listing read as a
-- real place rather than a placeholder. The wizard now greys Next until three
-- are added; this is the server mirror, so a crafted submit or a future route
-- can't slip past it (Liam, 20 Oct 2026).
--
-- GUEST only, and only the move INTO pending_review. An already-approved
-- experience returns early (the v_status check), so experiences approved with
-- fewer than three keep working untouched — the rule holds new submissions, not
-- what is already live. A host trade is unaffected.
--
-- Everything else is carried forward unchanged from
-- 20261020104337_submit_requires_weekly_hours.sql: the owner and approved
-- checks, the description and weekly-hours rules, the host pricing and coverage
-- rules, and the current-version agreement wall.

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
    v_photos           text[];
    v_quote            boolean;
    v_hourly           numeric;
    v_flat             numeric;
    v_areas            int;
    v_hours            int;
    v_document         text;
    v_required_version text;
    v_title            text;
begin
    select "owner_id", "status", "audience", "shape", "description", "photos",
           "provides_quote", "hourly_rate", "flat_fee"
      into v_owner, v_status, v_audience, v_shape, v_description, v_photos,
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

    -- At least three photos — the wizard greys Next until there are three, and
    -- this is the server mirror. Guest only, and only at submit; an approved
    -- experience returned early above, so one already live with fewer keeps
    -- working.
    if v_audience = 'guest' and coalesce(array_length(v_photos, 1), 0) < 3 then
        raise exception 'Add at least three photos before submitting — guests pick an experience by its photos.';
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

-- Read back (the three-photo clause is present; the hours clause remains):
--   select
--     position('at least three photos before submitting' in pg_get_functiondef('public.submit_service_provider(uuid)'::regprocedure)) > 0
--     and position('weekly opening hours before submitting' in pg_get_functiondef('public.submit_service_provider(uuid)'::regprocedure)) > 0;
--     -- true
