-- Server-side guard on submitting a trade for review.
--
-- WHY
--
-- The sign-up wizard already refuses to submit a trade with no description or no
-- way to price the job (see submitProblems / pricingProblems in
-- lib/serviceProviders.ts). That is a browser check, and the one legitimate
-- status write for a signed-in provider goes through submit_service_provider()
-- — so this is where the same two rules belong as a wall the browser cannot get
-- around. A row that reached 'pending_review' with an empty description or no
-- price is a listing an owner cannot compare and cannot book from; the queue
-- should never receive one.
--
-- THE RULES, matching the wizard exactly:
--   * a description that is not blank; and
--   * at least one way to price — the "I provide a quote" tick, an hourly rate,
--     or a flat fee (provides_quote, hourly_rate, flat_fee).
--
-- GUEST EXPERIENCES ARE LEFT ALONE. A guest experience (audience = 'guest')
-- prices per menu item, not with a quote/hourly/flat, and its "description" is
-- the what-to-expect field — a different shape with its own gate. So the guard
-- runs only for a host trade (audience distinct from 'guest'); a guest submit is
-- unchanged.
--
-- Everything else about the function is unchanged from
-- 20260827185827_provider_status_grants.sql: it is still security definer, still
-- checks that auth.uid() owns the row, and still returns quietly for an already-
-- approved listing so an ordinary edit is never turned into an error.
--
-- provides_quote, hourly_rate and flat_fee all exist by now
-- (20260929143712_trade_pricing_simplify_and_registration_number.sql and
-- earlier), so no column is added here.
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
