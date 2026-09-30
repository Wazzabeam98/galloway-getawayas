-- Mirror the sign-up's go-live rules server-side (B's audit, finding 2).
--
-- WHY
--
-- With /api/services/apply gone, a trade is submitted either through the wizard
-- (browser INSERTs then this RPC) or the emailed-link /api/services/finish route.
-- Neither enforced completeness: submit_service_provider only checked ownership
-- and (since 20260929164512) a non-blank description + a pricing signal. A trade
-- could reach 'pending_review' with NO services and NO coverage — the DB allows
-- an empty row. The wizard's front-end rules were the only thing shaping it, and
-- those are bypassable by anyone posting as the signed-in owner.
--
-- THE RULES, matching the wizard, for a host trade (audience distinct from
-- 'guest'):
--   * a non-blank description (already);
--   * a way to price — quote / hourly / flat (already);
--   * at least one SERVICE — a service_provider_skills row (the "jobs you take
--     on" search) OR an offered service_provider_extras row (the capability
--     ticks); and
--   * at least one COVERAGE area (service_areas) — where they're available to
--     work; without one they cover nowhere and no host can reach them.
--
-- (The optional "emergency call-outs" / "scheduled work" ticks stay optional, by
-- design — they refine availability, they don't gate it.)
--
-- A guest experience is exempt from the trade rules exactly as before: it prices
-- per item and has its own shape.
--
-- Keep in step with the terms wall added in the same era: this RECREATES the
-- function, so it also re-asserts the description/pricing checks. (The terms
-- check lives in its own later migration on the feature branch; when that lands,
-- its version of the function must carry these checks too.)
--
-- Safe to run twice.

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
