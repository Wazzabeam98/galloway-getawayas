-- A first and a last name on every account, the way Airbnb asks for them.
--
-- WHAT GOES WRONG WITHOUT IT. The account held one "Full name" string, asked
-- for on a screen that could be walked away from, and every guest-facing
-- "Hosted by" took the FIRST WORD of it. A host who typed their business name
-- there — "The Dark Sky Dome", live on production — was shown to guests as
-- "Hosted by The". Several provider accounts have no name at all.
--
-- Two columns, first_name and last_name. The site now shows first_name and
-- never cuts a first name out of a longer string (lib/utils firstName). New
-- accounts give both on a Finish signing up screen straight after the code; an
-- existing account without them is asked before it can use the listing or
-- experience wizard or publish (lib/personName).
--
-- WRITES ARE SERVER-ONLY. The browser gets SELECT on the two columns (mirroring
-- full_name: authenticated yes, anon no — 20260924174233 took names off anon)
-- and NO insert/update. /api/account/name is the one writer: it validates with
-- lib/personName's validatePersonName — the same check the form runs — and
-- writes through the service role, keeping full_name in step as "first last".
--
-- BACKFILL. Every existing full_name of two or more words that doesn't start
-- with an article is split once: first word → first_name, the rest →
-- last_name ("Callum John King" → Callum / John King; they can change it in
-- account settings). That is exactly the first name the site already showed
-- for them, so nothing visible changes for those people. A one-word full_name
-- becomes first_name only (so they are asked for a last name). Anything that
-- starts "The/A/An" is left blank: it is a business, not a person, and that
-- account is asked for its name. On production on 19 Oct 2026 that was 10
-- people split, 1 business left blank, 5 accounts with no name at all.
--
-- profile_private (the counterparty view) gains the two columns on the END —
-- create or replace view can only append — with its definition otherwise
-- copied verbatim from production's pg_get_viewdef on 19 Oct 2026.
--
-- PUBLISHING AN EXPERIENCE. Providers submit through submit_service_provider,
-- which writes status 'pending_review' from the browser's session. A trigger
-- refuses that transition while the owner has no first and last name, so the
-- name is enforced in the database, not only by the wizard asking first. The
-- service role (seeds, admin tools: auth.uid() is null) is not affected. The
-- listing side is checked in /api/listings/publish, which is the only way a
-- listing goes live.
--
-- PRE-FLIGHT. Not destructive: two nullable columns, a backfill that only
-- fills NULLs, one view replaced with two columns appended, one trigger.

alter table "public"."profiles"
    add column if not exists "first_name" text,
    add column if not exists "last_name" text;

grant select ("first_name", "last_name") on table "public"."profiles" to "authenticated";

update "public"."profiles"
   set "first_name" = split_part(btrim("full_name"), ' ', 1),
       "last_name"  = nullif(btrim(substr(btrim("full_name"), length(split_part(btrim("full_name"), ' ', 1)) + 1)), '')
 where "first_name" is null
   and coalesce(btrim("full_name"), '') <> ''
   and lower(split_part(btrim("full_name"), ' ', 1)) not in ('the', 'a', 'an');

create or replace view "public"."profile_private" as
 SELECT id,
    full_name,
    preferred_name,
    show_full_name,
    avatar_url,
    email,
    phone,
    residential_address,
    stripe_account_id,
    stripe_charges_enabled,
    stripe_payouts_enabled,
    stripe_details_submitted,
    stripe_requirements_due,
    stripe_updated_at,
    payout_balance_owed,
    first_name,
    last_name
   FROM profiles p
  WHERE id = auth.uid() OR (EXISTS ( SELECT 1
           FROM bookings b
          WHERE b.status = 'confirmed'::text AND (b.payment_status = ANY (ARRAY['paid'::text, 'deposit_paid'::text])) AND (b.guest_id = auth.uid() AND b.host_id = p.id OR b.host_id = auth.uid() AND b.guest_id = p.id))) OR (EXISTS ( SELECT 1
           FROM profiles me
          WHERE me.id = auth.uid() AND me.is_admin = true));

create or replace function public.provider_submit_needs_owner_name()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.status = 'pending_review' and old.status is distinct from 'pending_review' then
    if not exists (
      select 1 from public.profiles p
       where p.id = new.owner_id
         and coalesce(btrim(p.first_name), '') <> ''
         and coalesce(btrim(p.last_name), '') <> ''
    ) then
      raise exception 'Add your first and last name before you send this for review.'
        using errcode = 'P0001', hint = 'NAME_REQUIRED';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.provider_submit_needs_owner_name() from public, anon, authenticated;

drop trigger if exists provider_submit_needs_owner_name on public.service_providers;
create trigger provider_submit_needs_owner_name
  before update of status on public.service_providers
  for each row execute function public.provider_submit_needs_owner_name();

notify pgrst, 'reload schema';

-- Read back:
--   select column_name from information_schema.columns
--    where table_name = 'profiles' and column_name in ('first_name','last_name');
--   select grantee, privilege_type, column_name from information_schema.column_privileges
--    where table_name = 'profiles' and column_name in ('first_name','last_name');
--   select count(*) filter (where first_name is not null) from profiles;
