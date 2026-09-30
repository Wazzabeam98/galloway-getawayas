-- agreement acceptances and the submit wall
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- The site now has four agreements, Airbnb-style (lib/agreements.ts): the
-- Terms of Service everyone accepts, and one extra agreement per role — Host,
-- Experience Provider, Tradesperson. Each acceptance is recorded here: which
-- document, which version, the server's time, against the account. Without the
-- table, /api/agreements has nowhere to write, the sign-in prompt can't tell who
-- has agreed, and the sign-ups cannot prove what anybody accepted.
--
-- The rows are written only by the server with the service role
-- (/api/agreements, /api/listings/publish). A signed-in user may read their own
-- (RLS); nobody in a browser may write one.
--
-- BACKFILL. Two acceptances already exist elsewhere and are copied in so nobody
-- is asked twice for what they already agreed to:
--   * profiles.host_terms_version / _agreed_at (the host terms since 28/09/2026)
--     -> document 'host'. The Host Agreement is that same text, moved out of
--     /terms word for word, at the same version.
--   * service_providers.declarations ->> terms_version / terms_agreed_at on a
--     guest experience -> document 'experience_provider' (the same text, same
--     version, lib/providerTerms.ts).
--
-- THE SUBMIT WALL. submit_service_provider() is the only way a provider's row
-- reaches 'pending_review', and the browser calls it directly — so it is where
-- "no agreement, no submit" has to live. It now refuses a submit from an
-- account with no acceptance of the role's agreement (Experience Provider for a
-- guest experience, Tradesperson for a trade). The CURRENT-version check is in
-- /api/agreements, which refuses to record a stale or missing version; this
-- wall only needs to know that one was recorded. Everything else about the
-- function is unchanged from 20260929190533_submit_guard_services_and_coverage.sql
-- (description, pricing, at least one service, at least one coverage area for a
-- trade) — this migration sorts after it and must carry all of its checks, or
-- a later create-or-replace would silently drop them.
--
-- ORDER. Apply, then merge straight away. Between the two, the live wizard does
-- not yet record the agreement, so a provider pressing "Send for review" in that
-- window is refused with the agree message (their draft is kept).
--
-- PRE-FLIGHT (read-only, nothing is destructive here):
--   select count(*) from profiles where host_terms_version is not null;
--   select count(*) from service_providers where audience = 'guest'
--      and coalesce(declarations ->> 'terms_version', '') <> '';
--
-- Safe to run twice.

create table if not exists "public"."agreement_acceptances" (
    "id"          bigint generated always as identity primary key,
    "user_id"     uuid not null references auth.users (id) on delete cascade,
    "document"    text not null
                  check ("document" in ('guest', 'host', 'experience_provider', 'tradesperson')),
    "version"     text not null check (length("version") between 1 and 64),
    "accepted_at" timestamptz not null default now(),
    "source"      text,
    constraint "agreement_acceptances_one_per_version" unique ("user_id", "document", "version")
);

comment on table "public"."agreement_acceptances" is
    'One row per account per agreement version accepted (lib/agreements.ts). Written only by the server with the service role.';

create index if not exists "agreement_acceptances_user_document"
    on "public"."agreement_acceptances" ("user_id", "document");

alter table "public"."agreement_acceptances" enable row level security;

revoke all on "public"."agreement_acceptances" from anon, authenticated;
grant select on "public"."agreement_acceptances" to authenticated;

drop policy if exists "agreement_acceptances_read_own" on "public"."agreement_acceptances";
create policy "agreement_acceptances_read_own" on "public"."agreement_acceptances"
    for select to authenticated using ("user_id" = auth.uid());

-- Backfill: the host terms already recorded on profiles.
insert into "public"."agreement_acceptances" ("user_id", "document", "version", "accepted_at", "source")
select p."id", 'host', p."host_terms_version", coalesce(p."host_terms_agreed_at", now()), 'backfill:profiles'
  from "public"."profiles" p
  join auth.users u on u.id = p."id"
 where coalesce(p."host_terms_version", '') <> ''
on conflict on constraint "agreement_acceptances_one_per_version" do nothing;

-- Backfill: the provider terms already recorded in a guest experience's
-- declarations. A malformed timestamp falls back to submitted_at, then now().
insert into "public"."agreement_acceptances" ("user_id", "document", "version", "accepted_at", "source")
select distinct on (sp."owner_id", sp."declarations" ->> 'terms_version')
       sp."owner_id",
       'experience_provider',
       sp."declarations" ->> 'terms_version',
       coalesce(
           case when (sp."declarations" ->> 'terms_agreed_at') ~ '^\d{4}-\d{2}-\d{2}T'
                then (sp."declarations" ->> 'terms_agreed_at')::timestamptz end,
           sp."submitted_at",
           now()),
       'backfill:declarations'
  from "public"."service_providers" sp
  join auth.users u on u.id = sp."owner_id"
 where sp."audience" = 'guest'
   and coalesce(sp."declarations" ->> 'terms_version', '') <> ''
 order by sp."owner_id", sp."declarations" ->> 'terms_version', sp."submitted_at" nulls last
on conflict on constraint "agreement_acceptances_one_per_version" do nothing;

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
